// Shell-style tokenizer for pasted curl commands, including the $'...' quoting
// Chrome's "Copy as cURL" emits. Stops at an unquoted |, ; or &&.
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inToken = false;
  let i = 0;
  const n = input.length;

  const push = () => {
    if (inToken) tokens.push(cur);
    cur = "";
    inToken = false;
  };

  while (i < n) {
    const c = input[i]!;

    if (c === "\\" && (input[i + 1] === "\n" || (input[i + 1] === "\r" && input[i + 2] === "\n"))) {
      i += input[i + 1] === "\r" ? 3 : 2;
      continue;
    }

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      push();
      i++;
      continue;
    }

    if (c === "|" || c === ";" || (c === "&" && input[i + 1] === "&")) {
      break;
    }

    if (c === "'") {
      inToken = true;
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new TokenizeError("Unterminated single quote");
      cur += input.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    if (c === "$" && input[i + 1] === "'") {
      inToken = true;
      i += 2;
      while (i < n && input[i] !== "'") {
        if (input[i] === "\\" && i + 1 < n) {
          const [s, len] = ansiEscape(input, i + 1);
          cur += s;
          i += 1 + len;
        } else {
          cur += input[i];
          i++;
        }
      }
      if (i >= n) throw new TokenizeError("Unterminated $'...' quote");
      i++;
      continue;
    }

    if (c === '"') {
      inToken = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < n && '"\\$`\n'.includes(input[i + 1]!)) {
          if (input[i + 1] !== "\n") cur += input[i + 1];
          i += 2;
        } else {
          cur += input[i];
          i++;
        }
      }
      if (i >= n) throw new TokenizeError("Unterminated double quote");
      i++;
      continue;
    }

    if (c === "\\" && i + 1 < n) {
      inToken = true;
      cur += input[i + 1];
      i += 2;
      continue;
    }

    inToken = true;
    cur += c;
    i++;
  }
  push();
  return tokens;
}

export class TokenizeError extends Error {}

function ansiEscape(s: string, i: number): [string, number] {
  const c = s[i]!;
  switch (c) {
    case "n": return ["\n", 1];
    case "t": return ["\t", 1];
    case "r": return ["\r", 1];
    case "0": return ["\0", 1];
    case "a": return ["\x07", 1];
    case "b": return ["\b", 1];
    case "e": case "E": return ["\x1b", 1];
    case "f": return ["\f", 1];
    case "v": return ["\v", 1];
    case "x": {
      const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1));
      if (!m) return ["\\x", 1];
      return [String.fromCharCode(parseInt(m[0], 16)), 1 + m[0].length];
    }
    case "u":
    case "U": {
      const max = c === "u" ? 4 : 8;
      const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(s.slice(i + 1));
      if (!m) return ["\\" + c, 1];
      return [String.fromCodePoint(parseInt(m[0], 16)), 1 + m[0].length];
    }
    default:
      return [c, 1];
  }
}
