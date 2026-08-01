/**
 * Builds a minimal, valid sRGB ICC profile.
 *
 * PDF/A requires an OutputIntent carrying an embedded ICC profile - a file without one is
 * non-conforming however correct everything else is. That leaves three options: ship a binary blob
 * in the repository, read one from the host, or construct it. The host is not an option (a Docker
 * image or a serverless runtime need not have any ICC profile installed, and this one did not), and
 * a checked-in blob carries a licence question and cannot be reviewed in a diff.
 *
 * So it is constructed. A v2 matrix/TRC display profile is small and entirely specified: a
 * 128-byte header, a tag table, and nine tags. Building it here means the generator has no external
 * asset at all and produces byte-identical output on every machine.
 *
 * Reference: ICC.1:2001-04 (ICC v2.4), clauses 6 and 10.
 */

/** Four-character signatures are stored big-endian, like everything else in ICC. */
function sig(text: string): number {
  return (
    (text.charCodeAt(0) << 24) |
    (text.charCodeAt(1) << 16) |
    (text.charCodeAt(2) << 8) |
    text.charCodeAt(3)
  );
}

/** s15Fixed16Number: the value scaled by 2^16 and stored as a signed 32-bit integer. */
function s15Fixed16(value: number): number {
  return Math.round(value * 65536);
}

class ByteWriter {
  private readonly bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value >>> 8).u8(value);
  }

  u32(value: number): this {
    // `>>> 0` first: signed values (s15Fixed16 can be negative) must be written as their two's
    // complement bit pattern, not as a negative number.
    const unsigned = value >>> 0;
    return this.u8(unsigned >>> 24)
      .u8(unsigned >>> 16)
      .u8(unsigned >>> 8)
      .u8(unsigned);
  }

  sig(text: string): this {
    return this.u32(sig(text));
  }

  ascii(text: string): this {
    for (let i = 0; i < text.length; i += 1) this.u8(text.charCodeAt(i));
    return this;
  }

  zeros(count: number): this {
    for (let i = 0; i < count; i += 1) this.u8(0);
    return this;
  }

  /** ICC requires each tag's data to begin on a 4-byte boundary. */
  padTo4(): this {
    while (this.bytes.length % 4 !== 0) this.u8(0);
    return this;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * sRGB primaries and white point, chromatically adapted to the D50 PCS illuminant.
 *
 * These are the adapted values, not the sRGB primaries as usually quoted against D65: the ICC
 * profile connection space is defined at D50, so a profile stating D65 primaries alongside a D50
 * white point describes a colour space that is not sRGB.
 */
const PRIMARIES = {
  red: [0.43607, 0.22249, 0.0139] as const,
  green: [0.38515, 0.71687, 0.09708] as const,
  blue: [0.14307, 0.06061, 0.7141] as const,
  white: [0.9642, 1.0, 0.82491] as const,
};

/** Number of samples in the tone-reproduction curve. 1024 is ample for an 8-bit pipeline. */
const TRC_SAMPLES = 1024;

/**
 * The sRGB electro-optical transfer function (IEC 61966-2-1).
 *
 * Piecewise: linear near black, a 2.4 power law above. Sampling the real curve rather than
 * declaring a flat gamma of 2.2 costs 2 KB once and makes the profile actually sRGB rather than
 * approximately so.
 */
function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function xyzTag(xyz: readonly [number, number, number]): Uint8Array {
  const w = new ByteWriter();
  w.sig('XYZ ').zeros(4);
  for (const component of xyz) w.u32(s15Fixed16(component));
  return w.toBytes();
}

function curveTag(): Uint8Array {
  const w = new ByteWriter();
  w.sig('curv').zeros(4).u32(TRC_SAMPLES);
  for (let i = 0; i < TRC_SAMPLES; i += 1) {
    const linear = srgbToLinear(i / (TRC_SAMPLES - 1));
    w.u16(Math.min(0xffff, Math.max(0, Math.round(linear * 0xffff))));
  }
  return w.toBytes();
}

/**
 * `textDescriptionType`, the v2 form of a human-readable name.
 *
 * Its shape is a historical artefact - an ASCII string, then an unused Unicode block, then a
 * 67-byte fixed-size Macintosh ScriptCode field that must be present even when empty. Readers do
 * check the declared lengths, so the padding is not optional.
 */
function descriptionTag(text: string): Uint8Array {
  const w = new ByteWriter();
  const withNul = `${text}\0`;
  w.sig('desc').zeros(4).u32(withNul.length).ascii(withNul);
  w.u32(0).u32(0); // Unicode language code and count: none supplied.
  w.u16(0).u8(0); // ScriptCode code and count.
  w.zeros(67); // The fixed-size Macintosh description field.
  return w.toBytes();
}

function textTag(text: string): Uint8Array {
  const w = new ByteWriter();
  return w.sig('text').zeros(4).ascii(`${text}\0`).toBytes();
}

/**
 * A fixed creation date, so generation is deterministic.
 *
 * Two runs over the same invoice must produce identical bytes: an archived document is identified
 * by its hash, and a timestamp buried in a colour profile would change that hash for no reason.
 */
const PROFILE_DATE = { year: 2026, month: 1, day: 1 };

/** Builds the profile. The result is a complete `.icc` file, suitable for embedding directly. */
export function buildSrgbIccProfile(): Uint8Array {
  // Three TRC tags with identical content: the tag table points all of them at one copy of the
  // data, which ICC explicitly permits and which keeps the profile at 2 KB rather than 6.
  const curve = curveTag();
  const tags: Array<{ signature: string; data: Uint8Array }> = [
    { signature: 'desc', data: descriptionTag('sRGB IEC61966-2.1') },
    { signature: 'wtpt', data: xyzTag(PRIMARIES.white) },
    { signature: 'rXYZ', data: xyzTag(PRIMARIES.red) },
    { signature: 'gXYZ', data: xyzTag(PRIMARIES.green) },
    { signature: 'bXYZ', data: xyzTag(PRIMARIES.blue) },
    { signature: 'rTRC', data: curve },
    { signature: 'gTRC', data: curve },
    { signature: 'bTRC', data: curve },
    { signature: 'cprt', data: textTag('Public domain. Generated for PDF/A output intent.') },
  ];

  const HEADER_SIZE = 128;
  const tableSize = 4 + tags.length * 12;
  let offset = HEADER_SIZE + tableSize;
  // Tag data starts 4-byte aligned; the table itself is already a multiple of 4.
  offset += (4 - (offset % 4)) % 4;

  const placements: Array<{ signature: string; offset: number; size: number }> = [];
  const emitted = new Map<Uint8Array, number>();
  const body = new ByteWriter();

  for (const tag of tags) {
    const shared = emitted.get(tag.data);
    if (shared !== undefined) {
      placements.push({ signature: tag.signature, offset: shared, size: tag.data.length });
      continue;
    }
    const at = offset + body.length;
    for (const byte of tag.data) body.u8(byte);
    body.padTo4();
    emitted.set(tag.data, at);
    placements.push({ signature: tag.signature, offset: at, size: tag.data.length });
  }

  const totalSize = offset + body.length;

  const w = new ByteWriter();
  w.u32(totalSize);
  w.zeros(4); // Preferred CMM: none.
  w.u32(0x02100000); // Version 2.1.0.
  w.sig('mntr'); // Device class: display.
  w.sig('RGB ');
  w.sig('XYZ '); // Profile connection space.
  w.u16(PROFILE_DATE.year).u16(PROFILE_DATE.month).u16(PROFILE_DATE.day).u16(0).u16(0).u16(0);
  w.sig('acsp'); // The file signature every ICC profile carries.
  w.zeros(4); // Primary platform: unspecified.
  w.u32(0); // Profile flags: not embedded-only, use permitted.
  w.zeros(4); // Device manufacturer.
  w.zeros(4); // Device model.
  w.zeros(8); // Device attributes.
  w.u32(0); // Rendering intent: perceptual.
  // PCS illuminant. Fixed by the specification at D50, and readers verify it.
  w.u32(s15Fixed16(0.9642)).u32(s15Fixed16(1.0)).u32(s15Fixed16(0.8249));
  w.zeros(4); // Profile creator.
  w.zeros(16); // Profile ID (MD5): optional, left unset.
  w.zeros(28); // Reserved.

  w.u32(tags.length);
  for (const placement of placements) {
    w.sig(placement.signature).u32(placement.offset).u32(placement.size);
  }
  while (w.length < offset) w.u8(0);

  for (const byte of body.toBytes()) w.u8(byte);

  return w.toBytes();
}
