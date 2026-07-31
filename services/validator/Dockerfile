# syntax=docker/dockerfile:1

# ---- build stage -------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Copy the POM alone first so the dependency layer is cached independently of source edits.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q package -DskipTests

# ---- runtime stage -----------------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S validator && adduser -S -G validator validator
WORKDIR /app

COPY --from=build /build/target/validator-sidecar.jar ./validator-sidecar.jar

USER validator
EXPOSE 8081

ENV PORT=8081 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC -Xss512k"

# Warm-up runs at boot, so treat "warmed up" as the readiness signal rather than mere liveness.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8081/health | grep -q '"warmedUp":true' || exit 1

ENTRYPOINT ["java", "-jar", "/app/validator-sidecar.jar"]
