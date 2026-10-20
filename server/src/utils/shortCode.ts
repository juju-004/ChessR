import { customAlphabet } from "nanoid";

/**
 * Alphabet for game join codes and puzzle race codes: digits plus upper- and
 * lower-case letters, minus i/I and o/O (they read as 1 and 0 in most
 * typefaces). Codes are CASE-SENSITIVE, "aB3xYz" and "AB3XYZ" are different
 * codes, so nothing may upper/lower-case a code before looking it up.
 *
 * Tournament and cage match codes keep their own (uppercase-only) alphabets.
 */
export const SHORT_CODE_ALPHABET =
  "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjklmnpqrstuvwxyz";

export const generateShortCode = customAlphabet(SHORT_CODE_ALPHABET, 6);
