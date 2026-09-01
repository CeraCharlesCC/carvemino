// Codecs centralize boundary validation. assert validates without copying, while
// parse also detaches object/array containers from the caller's mutable input.
const OPTIONAL = Symbol("codec.optional");

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeLiteral(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function validateJsonValue(value, path, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} must contain only JSON-safe values`);
  if (seen.has(value)) throw new Error(`${path} must not contain circular references`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain sparse array entries`);
      validateJsonValue(value[index], `${path}[${index}]`, seen);
    }
  } else {
    if (!isPlainObject(value)) throw new Error(`${path} must contain only plain JSON objects`);
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function validate(schema, value, path) {
  switch (schema.kind) {
    case "unknown":
      return;
    case "json":
      validateJsonValue(value, path, new WeakSet());
      return;
    case "string": {
      if (typeof value !== "string" || (schema.nonEmpty && value.trim() === "")) {
        throw new Error(`${path} must be ${schema.nonEmpty ? "a non-empty string" : "a string"}`);
      }
      if (schema.maximumLength !== null && value.length > schema.maximumLength) {
        throw new Error(`${path} exceeds ${schema.maximumLength} characters`);
      }
      if (schema.pattern) {
        schema.pattern.lastIndex = 0;
        if (!schema.pattern.test(value)) {
          throw new Error(schema.patternMessage || `${path} has an invalid format`);
        }
      }
      return;
    }
    case "integer": {
      if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) {
        if (schema.maximum < Number.MAX_SAFE_INTEGER) {
          throw new Error(`${path} must be an integer between ${schema.minimum} and ${schema.maximum}`);
        }
        if (schema.minimum > Number.MIN_SAFE_INTEGER) {
          throw new Error(`${path} must be an integer >= ${schema.minimum}`);
        }
        throw new Error(`${path} must be an integer`);
      }
      return;
    }
    case "number": {
      if (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum) {
        if (schema.maximum < Number.POSITIVE_INFINITY) {
          throw new Error(`${path} must be a finite number between ${schema.minimum} and ${schema.maximum}`);
        }
        if (schema.minimum > Number.NEGATIVE_INFINITY) {
          throw new Error(`${path} must be a finite number >= ${schema.minimum}`);
        }
        throw new Error(`${path} must be a finite number`);
      }
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
      return;
    case "function":
      if (typeof value !== "function") throw new Error(`${path} must be a function`);
      return;
    case "literal":
      if (!Object.is(value, schema.value)) {
        throw new Error(`${path} must be ${describeLiteral(schema.value)}`);
      }
      return;
    case "enum":
      if (!schema.values.has(value)) {
        throw new Error(`${path} must be one of ${[...schema.values].map(describeLiteral).join(", ")}`);
      }
      return;
    case "nullable":
      if (value !== null) validate(schema.inner, value, path);
      return;
    case "optional":
      if (value !== undefined) validate(schema.inner, value, path);
      return;
    case "array": {
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      if (value.length < schema.minimumLength) {
        throw new Error(`${path} must contain at least ${schema.minimumLength} ${schema.entryLabel}`);
      }
      if (value.length > schema.maximumLength) {
        throw new Error(`${path} must contain at most ${schema.maximumLength} ${schema.entryLabel}`);
      }
      if (schema.exactLength !== null && value.length !== schema.exactLength) {
        throw new Error(`${path} must contain exactly ${schema.exactLength} ${schema.entryLabel}`);
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain sparse array entries`);
        validate(schema.item, value[index], `${path}[${index}]`);
      }
      return;
    }
    case "tuple": {
      if (!Array.isArray(value) || value.length !== schema.items.length) {
        throw new Error(`${path} must contain exactly ${schema.items.length} entries`);
      }
      schema.items.forEach((item, index) => validate(item, value[index], `${path}[${index}]`));
      return;
    }
    case "object": {
      if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.fields, key) && !schema.allowUnknown) {
          throw new Error(`${path}.${key} ${schema.unsupportedMessage}`);
        }
      }
      for (const [key, fieldSchema] of Object.entries(schema.fields)) {
        if (!Object.hasOwn(value, key)) {
          if (fieldSchema[OPTIONAL]) continue;
          throw new Error(`${path}.${key} is required`);
        }
        validate(fieldSchema, value[key], `${path}.${key}`);
      }
      return;
    }
    case "record": {
      if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
      const entries = Object.entries(value);
      if (schema.exactEntries !== null && entries.length !== schema.exactEntries) {
        throw new Error(`${path} must contain exactly ${schema.exactEntries} ${schema.entryLabel}`);
      }
      if (entries.length < schema.minimumEntries) {
        throw new Error(`${path} must contain at least ${schema.minimumEntries} ${schema.entryLabel}`);
      }
      if (entries.length > schema.maximumEntries) {
        throw new Error(`${path} must contain at most ${schema.maximumEntries} ${schema.entryLabel}`);
      }
      for (const [key, entry] of entries) {
        if (schema.key) validate(schema.key, key, `${path} key`);
        validate(schema.value, entry, `${path}.${key}`);
      }
      return;
    }
    case "union": {
      const errors = [];
      for (const variant of schema.variants) {
        try {
          validate(variant, value, path);
          return;
        } catch (error) {
          errors.push(error);
        }
      }
      throw errors[0] || new Error(`${path} is invalid`);
    }
    case "discriminatedUnion": {
      if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
      const discriminator = value[schema.discriminator];
      if (!Object.hasOwn(schema.variants, discriminator)) {
        if (schema.unsupportedMessage) {
          const message = typeof schema.unsupportedMessage === "function"
            ? schema.unsupportedMessage(path, discriminator)
            : schema.unsupportedMessage;
          throw new Error(message);
        }
        throw new Error(`${path}.${schema.discriminator} is unsupported: ${String(discriminator)}`);
      }
      const variant = schema.variants[discriminator];
      validate(variant, value, path);
      return;
    }
    case "refine":
      validate(schema.inner, value, path);
      schema.check(value, path);
      return;
    default:
      throw new Error(`Unknown codec schema kind: ${String(schema.kind)}`);
  }
}

function cloneValue(value, path, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error(`${path} must not contain circular references`);
  seen.set(value, true);
  let cloned;
  if (Array.isArray(value)) {
    cloned = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain sparse array entries`);
      cloned.push(cloneValue(value[index], `${path}[${index}]`, seen));
    }
  } else if (isPlainObject(value)) {
    cloned = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry, `${path}.${key}`, seen)])
    );
  } else {
    throw new Error(`${path} must contain only plain data`);
  }
  seen.delete(value);
  return cloned;
}

export const shape = Object.freeze({
  unknown() {
    return Object.freeze({ kind: "unknown" });
  },

  json() {
    return Object.freeze({ kind: "json" });
  },

  string({ nonEmpty = false, maximumLength = null, pattern = null, patternMessage = null } = {}) {
    return Object.freeze({ kind: "string", nonEmpty, maximumLength, pattern, patternMessage });
  },

  integer({ minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    return Object.freeze({ kind: "integer", minimum, maximum });
  },

  number({ minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY } = {}) {
    return Object.freeze({ kind: "number", minimum, maximum });
  },

  boolean() {
    return Object.freeze({ kind: "boolean" });
  },

  function() {
    return Object.freeze({ kind: "function" });
  },

  literal(value) {
    return Object.freeze({ kind: "literal", value });
  },

  enum(values) {
    return Object.freeze({ kind: "enum", values: new Set(values) });
  },

  nullable(inner) {
    return Object.freeze({ kind: "nullable", inner });
  },

  optional(inner) {
    return Object.freeze({ kind: "optional", inner, [OPTIONAL]: true });
  },

  array(item, {
    minimumLength = 0,
    maximumLength = Number.MAX_SAFE_INTEGER,
    exactLength = null,
    entryLabel = "entries"
  } = {}) {
    return Object.freeze({ kind: "array", item, minimumLength, maximumLength, exactLength, entryLabel });
  },

  tuple(items) {
    return Object.freeze({ kind: "tuple", items: Object.freeze([...items]) });
  },

  object(fields, { allowUnknown = false, unsupportedMessage = "is not supported" } = {}) {
    return Object.freeze({
      kind: "object",
      fields: Object.freeze({ ...fields }),
      allowUnknown,
      unsupportedMessage
    });
  },

  record(value, {
    key = null,
    minimumEntries = 0,
    maximumEntries = Number.MAX_SAFE_INTEGER,
    exactEntries = null,
    entryLabel = "entries"
  } = {}) {
    return Object.freeze({
      kind: "record",
      value,
      key,
      minimumEntries,
      maximumEntries,
      exactEntries,
      entryLabel
    });
  },

  union(variants) {
    return Object.freeze({ kind: "union", variants: Object.freeze([...variants]) });
  },

  discriminatedUnion(discriminator, variants, { unsupportedMessage = null } = {}) {
    return Object.freeze({
      kind: "discriminatedUnion",
      discriminator,
      variants: Object.freeze({ ...variants }),
      unsupportedMessage
    });
  },

  refine(inner, check) {
    return Object.freeze({ kind: "refine", inner, check });
  }
});

export function defineCodec(schema) {
  const parse = (value, path = "value") => {
    validate(schema, value, path);
    return cloneValue(value, path);
  };
  return Object.freeze({
    assert(value, path = "value") {
      validate(schema, value, path);
      return value;
    },

    parse,

    tryParse(value, path = "value") {
      try {
        return parse(value, path);
      } catch {
        return null;
      }
    },

    stringify(value, path = "value") {
      return JSON.stringify(parse(value, path));
    }
  });
}
