package fr.facturx.validator;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.mustangproject.validator.ZUGFeRDValidator;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * HTTP front-end for Mustangproject's Factur-X / ZUGFeRD validator.
 *
 * <p>Deliberately thin: it hands back Mustang's native XML report untouched. Parsing the report,
 * mapping {@code BR-*} rule identifiers to French explanations, and everything else user-facing
 * is the job of {@code packages/facturx}. Keeping the Java surface this small means there is only
 * one implementation of the interpretation logic, and it lives in the language the rest of the
 * stack is written in.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code GET  /health} &rarr; JSON liveness probe, also reports whether warm-up completed.</li>
 *   <li>{@code POST /validate} &rarr; raw file bytes in the body, filename via the {@code X-Filename}
 *       header or {@code ?filename=}. Responds with {@code application/xml}, Mustang's report.</li>
 * </ul>
 */
public final class ValidatorServer {

  /** Factur-X files are small; anything larger is a misuse of the endpoint. */
  private static final int MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

  private static final String DEFAULT_FILENAME = "invoice.xml";

  private static volatile boolean warmedUp = false;

  private ValidatorServer() {}

  public static void main(String[] args) throws IOException {
    final int port = envInt("PORT", 8081);
    final int threads = envInt("VALIDATOR_THREADS", Math.max(2, Runtime.getRuntime().availableProcessors()));

    final HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
    server.createContext("/health", ValidatorServer::handleHealth);
    server.createContext("/validate", ValidatorServer::handleValidate);
    server.setExecutor(Executors.newFixedThreadPool(threads));
    server.start();

    log("listening on :" + port + " with " + threads + " worker threads");

    // The first validation pays for class loading and Schematron/XSLT compilation - several
    // seconds. Doing it at boot rather than on a user's first upload keeps the public validator
    // feeling instant. Runs off-thread so the port is accepting connections immediately.
    Thread.ofVirtual().name("warmup").start(ValidatorServer::warmUp);

    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      log("shutting down");
      server.stop(5);
      if (server.getExecutor() instanceof ThreadPoolExecutor pool) {
        pool.shutdown();
        try {
          pool.awaitTermination(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    }));
  }

  /**
   * Forces the expensive one-time initialisation using a minimal CII document. The document is
   * intentionally invalid - we only care that the validation machinery is loaded, not the verdict.
   */
  private static void warmUp() {
    final long start = System.currentTimeMillis();
    try {
      final String stub =
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
              + "<rsm:CrossIndustryInvoice"
              + " xmlns:rsm=\"urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100\">"
              + "</rsm:CrossIndustryInvoice>";
      new ZUGFeRDValidator().validate(stub.getBytes(StandardCharsets.UTF_8), "warmup.xml");
      warmedUp = true;
      log("warm-up complete in " + (System.currentTimeMillis() - start) + "ms");
    } catch (RuntimeException e) {
      // A failed warm-up is not fatal: real requests will just pay the initialisation cost.
      log("warm-up failed (non-fatal): " + e);
    }
  }

  private static void handleHealth(HttpExchange exchange) throws IOException {
    if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
      respondJson(exchange, 405, "{\"error\":\"method_not_allowed\"}");
      return;
    }
    respondJson(exchange, 200, "{\"status\":\"ok\",\"warmedUp\":" + warmedUp + "}");
  }

  private static void handleValidate(HttpExchange exchange) throws IOException {
    if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
      respondJson(exchange, 405, "{\"error\":\"method_not_allowed\",\"hint\":\"POST raw file bytes\"}");
      return;
    }

    final byte[] body;
    try (InputStream in = exchange.getRequestBody()) {
      // Read one byte past the cap so an oversized payload is detectable.
      body = in.readNBytes(MAX_UPLOAD_BYTES + 1);
    }

    if (body.length == 0) {
      respondJson(exchange, 400, "{\"error\":\"empty_body\"}");
      return;
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      respondJson(exchange, 413, "{\"error\":\"payload_too_large\",\"maxBytes\":" + MAX_UPLOAD_BYTES + "}");
      return;
    }

    final String filename = resolveFilename(exchange);
    final long start = System.currentTimeMillis();

    try {
      // ZUGFeRDValidator carries per-run state, so it must not be shared between requests.
      final ZUGFeRDValidator validator = new ZUGFeRDValidator();
      final String report = validator.validate(body, filename);

      final long duration = System.currentTimeMillis() - start;
      exchange.getResponseHeaders().set("X-Validation-Duration-Ms", String.valueOf(duration));
      exchange.getResponseHeaders().set("X-Validation-Valid", String.valueOf(validator.wasCompletelyValid()));
      respond(exchange, 200, "application/xml; charset=utf-8", report.getBytes(StandardCharsets.UTF_8));

      log("validated " + filename + " (" + body.length + "B) valid="
          + validator.wasCompletelyValid() + " in " + duration + "ms");
    } catch (RuntimeException e) {
      // Mustang throws on genuinely unparseable input. Surface it as a server-side signal rather
      // than pretending the document was merely invalid - the two mean different things upstream.
      log("validation threw for " + filename + ": " + e);
      respondJson(exchange, 500, "{\"error\":\"validation_failed\",\"detail\":\"" + jsonEscape(String.valueOf(e.getMessage())) + "\"}");
    }
  }

  /**
   * Mustang keys some behaviour off the file extension (notably whether to attempt PDF/A-3
   * extraction), so the client-supplied name matters.
   */
  private static String resolveFilename(HttpExchange exchange) {
    final String header = exchange.getRequestHeaders().getFirst("X-Filename");
    if (header != null && !header.isBlank()) {
      return sanitiseFilename(header);
    }
    final String query = exchange.getRequestURI().getRawQuery();
    if (query != null) {
      for (final String pair : query.split("&")) {
        final int eq = pair.indexOf('=');
        if (eq > 0 && "filename".equals(pair.substring(0, eq))) {
          return sanitiseFilename(URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
      }
    }
    return DEFAULT_FILENAME;
  }

  /**
   * Strips any path component. The name is only ever used as a label and an extension hint, but it
   * arrives from an untrusted upload, so it must not be able to express a path.
   */
  private static String sanitiseFilename(String raw) {
    String name = raw.replace('\\', '/');
    final int slash = name.lastIndexOf('/');
    if (slash >= 0) {
      name = name.substring(slash + 1);
    }
    name = name.replaceAll("[\\p{Cntrl}]", "").trim();
    if (name.isEmpty() || ".".equals(name) || "..".equals(name)) {
      return DEFAULT_FILENAME;
    }
    return name.length() > 255 ? name.substring(name.length() - 255) : name;
  }

  private static void respondJson(HttpExchange exchange, int status, String json) throws IOException {
    respond(exchange, status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
  }

  private static void respond(HttpExchange exchange, int status, String contentType, byte[] payload)
      throws IOException {
    exchange.getResponseHeaders().set("Content-Type", contentType);
    exchange.sendResponseHeaders(status, payload.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(payload);
    }
  }

  private static String jsonEscape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
  }

  private static int envInt(String key, int fallback) {
    final Map<String, String> env = System.getenv();
    final String raw = env.get(key);
    if (raw == null || raw.isBlank()) {
      return fallback;
    }
    try {
      return Integer.parseInt(raw.trim());
    } catch (NumberFormatException e) {
      log("ignoring invalid " + key + "=" + raw + ", using " + fallback);
      return fallback;
    }
  }

  private static void log(String message) {
    System.out.println("[validator] " + message);
  }
}
