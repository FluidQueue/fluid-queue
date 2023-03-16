"use strict";

const path = require("path");
const fs = require("fs");
const settings = require("./settings.js");
const aliasManagement = require("./aliases.js");
const aliases = aliasManagement.aliases();

const defaultActivated = [
  "smm2",
  "customcode",
  "customlevel",
  "smm1",
  "smm2-regex",
];

const fileEnding = ".js";
const loadFiles = (directory) => {
  const result = {};
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(fileEnding));
  for (const file of files) {
    const filePath = path.join(directory, file);
    const name = file.slice(0, -fileEnding.length);
    const module = require(filePath);
    result[name] = module;
  }
  return result;
};

const resolvers = {
  available: {},
  activatedOrder: [],
  activatedSet: new Set(),
  load() {
    // load settings
    if (settings.resolvers != null) {
      this.activatedOrder = settings.resolvers;
    } else {
      this.activatedOrder = defaultActivated;
    }
    this.activatedOrder = this.activatedOrder.filter(
      (activated) => activated in this.available
    );
    this.activatedOrder.forEach((activated) =>
      this.activatedSet.add(activated)
    );
    console.log(`Resolvers: [${this.activatedOrder.join(", ")}]`);
  },
  register(name, resolver) {
    this.available[name] = resolver;
  },
  get(name) {
    if (name in this.available && this.activatedSet.has(name)) {
      return this.available[name];
    }
    return null;
  },
  *[Symbol.iterator]() {
    for (const name of this.activatedOrder) {
      if (name in this.available) {
        yield this.available[name];
      }
    }
  },
};

const bindings = {
  objectBindings: {},
  ensureObjectBinding(name) {
    if (!(name in this.objectBindings)) {
      this.objectBindings[name] = {};
    }
  },
  getObjectBinding(name) {
    this.ensureObjectBinding(name);
    return this.objectBindings[name];
  },
  overrideObjectBinding(name, newValue) {
    this.ensureObjectBinding(name);
    const binding = this.objectBindings[name];
    const oldValue = { ...binding };
    Object.keys(binding).forEach((key) => {
      delete binding[key];
    });
    Object.assign(binding, newValue);
    return oldValue;
  },
  getObjectBindings() {
    return this.objectBindings;
  },
};

const commands = {
  handlers: {},
  register(name, handler) {
    this.handlers[name] = handler;
    aliases.addDefault(name, handler.aliases);
  },
  get_remainder(x) {
    var index = x.indexOf(" ");
    if (index == -1) {
      return "";
    }
    return x.substr(index + 1);
  },
  async handle(message, sender, respond) {
    for (const name in this.handlers) {
      if (aliases.isAlias(name, message)) {
        const handler = this.handlers[name];
        return await handler.handle(
          this.get_remainder(message),
          sender,
          respond
        );
      }
    }
  },
};

const extensions = {
  // TODO: remove environment
  environment: {},
  resolvers,
  entryTypes: {},
  extensions: [],
  bindings,
  commands,
  getQueueBinding(name) {
    return this.bindings.getObjectBinding(name);
  },
  overrideQueueBinding(name, newValue) {
    return this.bindings.overrideObjectBinding(name, newValue);
  },
  registerCommand(name, handler) {
    // TODO: fix
    // const AsyncFunction = (async () => {}).constructor;
    /* if (!("handle" in handler && handler.resolve instanceof AsyncFunction)) {
      throw new Error(`Command handler ${name} does not have an async handle function`);
    } */
    if (!("aliases" in handler && Array.isArray(handler.aliases))) {
      throw new Error(`Command handler ${name} does not have an aliases array`);
    }
    this.commands.register(name, handler);
  },
  async handleCommands(message, sender, respond) {
    return await this.commands.handle(message, sender, respond);
  },
  /**
   * TODO: remove function
   */
  getCustomCodes() {
    return this.environment.customCodes;
  },

  /**
   * loads extensions
   */
  load(environment) {
    // TODO: remove environment
    this.environment = environment;
    // load extensions
    const extensionsPath = path.resolve(__dirname, "extensions");
    this.extensions = loadFiles(extensionsPath);
    // setup extensions
    Object.entries(this.extensions).forEach(([name, extension]) => {
      if ("setup" in extension && typeof extension.setup === "function") {
        extension.setup(this);
      } else {
        console.warn(`Extension ${name} does not have a setup function`);
      }
    });
    console.log(`Extensions: [${Object.keys(this.extensions).join(", ")}]`);
    // load resolvers
    this.resolvers.load();
  },
  registerEntryType(name, entryType) {
    if (!("display" in entryType && typeof entryType.display === "function")) {
      throw new Error(`Entry type ${name} does not have a display function`);
    }
    this.entryTypes[name] = entryType;
  },
  registerResolver(name, resolver) {
    if (!("resolve" in resolver && typeof resolver.resolve === "function")) {
      throw new Error(`Resolver ${name} does not have a resolve function`);
    }
    this.resolvers.register(name, resolver);
  },
  get availableResolvers() {
    return this.activated
      .filter((name) => name in this.available)
      .map((name) => this.available[name])
      .filter((resolver) => resolver != null);
  },
  displayFallback(entry) {
    // try to fallback to code
    const code = entry.code;
    if (code == null) {
      // can not display queue entry
      console.error("Can not display queue entry: %s", JSON.stringify(entry));
      return "unknown entry";
    }
    return code;
  },
  display(entry) {
    const type = entry.type;
    if (type != null && type in this.entryTypes) {
      const entryType = this.entryTypes[type];
      return entryType.display(entry);
    }
    return this.displayFallback(entry);
  },
  resolve(args) {
    const descriptions = new Set();
    // check if args start with a resolver name
    let [resolverName, ...resolverArgs] = args.trim().split(/\s+/);
    const resolver = this.resolvers.get(resolverName);
    if (resolver != null) {
      const entry = resolver.resolve(resolverArgs.join(" "));
      return {
        entry,
        description: resolver.description,
        descriptions: [],
      };
    }
    resolverArgs = [resolverName, ...resolverArgs];
    // run all resolvers in order until first one resolves otherwise
    for (const resolver of this.resolvers) {
      const entry = resolver.resolve(resolverArgs.join(" "));
      if (entry != null) {
        return {
          entry,
          description: resolver.description,
          descriptions: [],
        };
      }
      if (resolver.description != null) {
        descriptions.add(resolver.description);
      }
    }
    return {
      entry: null,
      description: null,
      descriptions: [...descriptions],
    };
  },
};

module.exports = extensions;
