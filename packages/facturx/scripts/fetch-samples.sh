#!/usr/bin/env bash
#
# Downloads real-world Factur-X / CII sample documents into the golden-file corpus.
#
# These come from the Mustangproject test suite - files that a widely-used, independent
# implementation asserts against. Validating our extraction and parsing against documents we did
# not write ourselves is the point: our own fixtures can only ever encode our own assumptions.
#
# The corpus is NOT committed (see .gitignore). It is opt-in because it needs network access, and
# the committed fixtures in test/fixtures/ must be enough to run the suite offline.
#
# Usage: pnpm --filter @facturx/core fetch-samples

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS_DIR="${SCRIPT_DIR}/../test/corpus/vendor"
BASE_URL="https://raw.githubusercontent.com/ZUGFeRD/mustangproject/master/library/src/test/resources"

mkdir -p "${CORPUS_DIR}"

# Chosen for coverage rather than volume:
#   EN16931_Einfach.pdf  - a genuine Factur-X PDF/A-3; exercises attachment extraction end to end
#   EN16931_1_Teilrechnung.pdf - partial invoice, EN 16931 profile
#   factur-x-extended.xml - EXTENDED profile, exercises profile detection at the richest level
#   Extended_fremdwaehrung.xml - foreign currency, exercises BT-5/BT-111 handling
#   cii/Factur-X_basic.xml - BASIC profile, our default output profile
#   cii/facturFrMinimum.xml - a French MINIMUM-profile invoice; exercises both profile detection
#                             and the warning that MINIMUM is unfit for a VAT-registered issuer
FILES=(
  "EN16931_Einfach.pdf"
  "EN16931_1_Teilrechnung.pdf"
  "factur-x-extended.xml"
  "Extended_fremdwaehrung.xml"
  "cii/Factur-X_basic.xml"
  "cii/facturFrMinimum.xml"
)

echo "Fetching Factur-X sample corpus into ${CORPUS_DIR}"

for file in "${FILES[@]}"; do
  # Flatten any subdirectory into the filename so the corpus stays a single directory.
  target="${CORPUS_DIR}/$(basename "${file}")"
  if [ -f "${target}" ]; then
    echo "  = ${file} (already present)"
    continue
  fi
  if curl -fsSL --max-time 60 -o "${target}" "${BASE_URL}/${file}"; then
    echo "  + ${file} ($(wc -c < "${target}") bytes)"
  else
    echo "  ! ${file} could not be fetched; skipping" >&2
    rm -f "${target}"
  fi
done

echo
echo "Done. Corpus tests will now run against these files."
echo "Note: these samples originate from the Mustangproject project and are used here as"
echo "third-party reference documents for testing only."
