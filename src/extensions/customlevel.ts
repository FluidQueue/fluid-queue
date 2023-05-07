import ExtensionsApi from "../extensions.js";
import { Chatter, Responder } from "../extensions-api/command.js";
import {
  PersistedBinding,
  TypedBinding,
} from "../extensions-api/queue-binding.js";
import { QueueEntry } from "../extensions-api/queue-entry.js";
import settings from "../settings.js";
import { checkVersion } from "./helpers/version.js";
import { v5 as uuidv5, v4 as uuidv4, validate as uuidValidate } from "uuid";
import { z } from "zod";

import i18next from "i18next";
if (process && process.env && process.env.NODE_ENV != "test") {
  // Tests are hecking weird, and don't need this, and break because of this
  // This feels like a hack but it works
  await import("./helpers/i18n.js");
}
await i18next.loadNamespaces("customlevel");

const QUEUE_NAMESPACE = "1e511052-e714-49bb-8564-b60915cf7279"; // this is the namespace for *known* level types for the queue (Version 4 UUID)
const ROMHACK_UUID = uuidv5("ROMhack", QUEUE_NAMESPACE);
const UNCLEARED_UUID = uuidv5("Uncleared", QUEUE_NAMESPACE);

if (ROMHACK_UUID == null || UNCLEARED_UUID == null) {
  throw new Error("Error creating uuids for ROMhack and uncleared levels.");
}

const romHackLevel = () => {
  return {
    code: ROMHACK_UUID,
    type: "customlevel",
  };
};

const unclearedLevel = () => {
  return {
    code: UNCLEARED_UUID,
    type: "customlevel",
  };
};

const isRomHackLevel = (entry: QueueEntry): boolean => {
  // FIXME: this is not ideal -> rewrite queueHandler.check
  const raw = entry.serializePersistedQueueEntry();
  return raw.type == "customlevel" && raw.code == ROMHACK_UUID;
};

const isUnclearedLevel = (entry: QueueEntry): boolean => {
  // FIXME: this is not ideal -> rewrite queueHandler.check
  const raw = entry.serializePersistedQueueEntry();
  return raw.type == "customlevel" && raw.code == UNCLEARED_UUID;
};

const display = (custom: CustomData) => {
  return (code: string) => {
    const uuid = code;
    if (custom.has(uuid)) {
      const description = custom.get(uuid);
      return description.name;
    } else {
      const name = `unknown custom level (${uuid})`;
      custom.add(uuid, {
        codes: [uuid],
        name,
        enabled: false,
      });
      return name;
    }
  };
};

const CustomLevelV1 = z.object({
  name: z.string(),
  codes: z.array(z.string()),
  enabled: z.boolean(),
});
type CustomLevelV1 = z.infer<typeof CustomLevelV1>;
const CustomDataV1 = z.record(CustomLevelV1);
type CustomDataV1 = z.infer<typeof CustomDataV1>;

class CustomTransient {
  cache: { codes: Map<string, string>; names: Map<string, string> } = {
    codes: new Map(),
    names: new Map(),
  };
  constructor(data: CustomDataV1) {
    Object.entries(data).forEach(([uuid, value]) => {
      this.cache.names.set(value.name.trim().toUpperCase(), uuid);
      value.codes.forEach((code) => {
        this.cache.codes.set(code.trim().toUpperCase(), uuid);
      });
    });
  }
  get names() {
    return this.cache.names;
  }
  get codes() {
    return this.cache.codes;
  }
}

class CustomData {
  binding: TypedBinding<CustomDataV1, CustomTransient>;

  constructor(binding: TypedBinding<CustomDataV1, CustomTransient>) {
    this.binding = binding;
  }
  get data(): CustomDataV1 {
    return this.binding.data;
  }
  get cache(): { codes: Map<string, string>; names: Map<string, string> } {
    return this.binding.transient.cache;
  }
  fromName(name: string): string | null {
    return this.cache.names.get(name.trim().toUpperCase()) ?? null;
  }
  fromCode(code: string): string | null {
    return this.cache.codes.get(code.trim().toUpperCase()) ?? null;
  }
  fromArguments(args: string): string | null {
    const fromCode = this.fromCode(args);
    if (fromCode != null) {
      return fromCode;
    }
    const fromName = this.fromName(args);
    if (fromName != null) {
      return fromName;
    }
    return null;
  }
  get(uuid: string): CustomLevelV1 {
    return this.data[uuid];
  }
  has(uuid: string): boolean {
    return uuid in this.data;
  }
  remove(uuid: string): boolean {
    if (this.has(uuid)) {
      const value = this.get(uuid);
      this.cache.names.delete(value.name.trim().toUpperCase());
      value.codes.forEach((code) => {
        this.cache.codes.delete(code.trim().toUpperCase());
      });
      delete this.data[uuid];
      return true;
    }
    return false;
  }
  add(uuid: string, value: CustomLevelV1) {
    if (this.has(uuid)) {
      this.remove(uuid);
    }
    this.data[uuid] = value;
    this.cache.names.set(value.name.trim().toUpperCase(), uuid);
    value.codes.forEach((code) => {
      this.cache.codes.set(code.trim().toUpperCase(), uuid);
    });
  }
  list(admin: boolean): string[] {
    return Object.entries(this.data).flatMap(([, value]) => {
      // translate customLevels into custom code map
      if (value.enabled || admin) {
        return (
          [value.name + " [" + value.codes.join(", ") + "]"] +
          (admin ? " (" + (value.enabled ? "enabled" : "disabled") + ")" : "")
        );
      } else {
        return [];
      }
    });
  }
  addRomHack(enabled = true) {
    if (this.has(ROMHACK_UUID)) {
      const value = this.get(ROMHACK_UUID);
      this.remove(ROMHACK_UUID);
      const result = value.enabled != enabled;
      value.enabled = enabled;
      this.add(ROMHACK_UUID, value);
      return result;
    } else {
      this.add(ROMHACK_UUID, {
        codes: ["ROMhack", "R0M-HAK-LVL"],
        name: "a ROMhack",
        enabled,
      });
      return true;
    }
  }
  addUncleared(enabled = true) {
    if (this.has(UNCLEARED_UUID)) {
      const value = this.get(UNCLEARED_UUID);
      this.remove(UNCLEARED_UUID);
      const result = value.enabled != enabled;
      value.enabled = enabled;
      this.add(UNCLEARED_UUID, value);
      return result;
    } else {
      this.add(UNCLEARED_UUID, {
        codes: ["Uncleared", "UNC-LEA-RED"],
        name: "an uncleared level",
        enabled,
      });
      return true;
    }
  }
  removeRomHack() {
    return this.remove(ROMHACK_UUID);
  }
  removeUncleared() {
    return this.remove(UNCLEARED_UUID);
  }
  save() {
    this.binding.save();
  }
}

const nameResolver = (custom: CustomData) => {
  return (args: string) => {
    // TODO prevent custom codes from saving the custom levels as custom codes
    const uuid = custom.fromName(args);
    if (uuid != null && custom.get(uuid).enabled) {
      return { code: uuid };
    }
    return null;
  };
};

const resolver = (custom: CustomData) => {
  return (args: string) => {
    // TODO prevent custom codes from saving the custom levels as custom codes
    const uuid = custom.fromCode(args);
    if (uuid != null && custom.get(uuid).enabled) {
      return { code: uuid };
    }
    return null;
  };
};

const customlevelCommand = (custom: CustomData) => {
  return {
    aliases: ["!customlevel", "!customlevels"],
    async handle(message: string, sender: Chatter, respond: Responder) {
      if (sender.isBroadcaster) {
        if (message == "") {
          respond(this.customLevels(true));
        } else {
          const args = message.trim().split(" ");
          let [command] = args;
          const [, ...rest] = args;
          command = command.toLowerCase();
          if (command == "code" && rest.length >= 2) {
            const [subcommand, code, ...codeOrNameRest] = rest;
            if (subcommand == "add" && codeOrNameRest.length >= 1) {
              const codeOrName = codeOrNameRest.join(" ");
              const fromCode = custom.fromCode(code);
              if (fromCode != null) {
                respond(
                  i18next.t("customlevelCodeExists", {
                    ns: "customlevel",
                    code,
                    name: custom.get(fromCode).name,
                    codes: custom.get(fromCode).codes.join(", "),
                  })
                );
                return;
              }
              const fromArguments = custom.fromArguments(codeOrName);
              if (fromArguments != null) {
                const value = custom.get(fromArguments);
                value.codes.push(code);
                custom.add(fromArguments, value);
                custom.save();
                respond(
                  i18next.t("customlevelCodeAdded", {
                    ns: "customlevel",
                    code,
                    name: value.name,
                    codes: value.codes.join(", "),
                  })
                );
                return;
              }
              respond(
                i18next.t("customlevelNotFound", {
                  ns: "customlevel",
                  codeOrName,
                })
              );
              return;
            } else if (subcommand == "remove") {
              const fromCode = custom.fromCode(code);
              if (fromCode != null) {
                const value = custom.get(fromCode);
                const newCodes = value.codes.filter(
                  (c) => c.toUpperCase() != code.trim().toUpperCase()
                );
                if (newCodes.length == 0) {
                  respond(
                    i18next.t("cannotRemove", {
                      ns: "customlevel",
                      code,
                      name: custom.get(fromCode).name,
                      codes: custom.get(fromCode).codes.join(", "),
                    })
                  );
                  return;
                }
                custom.remove(fromCode);
                value.codes = newCodes;
                custom.add(fromCode, value);
                custom.save();
                respond(
                  i18next.t("customlevelCodeRemoved", {
                    ns: "customlevel",
                    code,
                    name: custom.get(fromCode).name,
                    codes: custom.get(fromCode).codes.join(", "),
                  })
                );
                return;
              }
              respond(
                i18next.t("customlevelCodeNotFound", {
                  ns: "customlevel",
                  code,
                })
              );
              return;
            } else {
              respond(i18next.t("syntax", { ns: "customlevel" }));
              return;
            }
          } else if (
            (command == "enable" || command == "disable") &&
            rest.length >= 1
          ) {
            const codeOrName = rest.join(" ");
            const fromArguments = custom.fromArguments(codeOrName);
            if (fromArguments != null) {
              const value = custom.get(fromArguments);
              value.enabled = command == "enable";
              custom.add(fromArguments, value);
              custom.save();
              if (command == "enable") {
                respond(
                  i18next.t("customlevelEnabled", {
                    ns: "customlevel",
                    name: value.name,
                    codes: value.codes.join(", "),
                  })
                );
              } else {
                respond(
                  i18next.t("customlevelDisabled", {
                    ns: "customlevel",
                    name: value.name,
                    codes: value.codes.join(", "),
                  })
                );
              }
              return;
            }
            respond(
              i18next.t("customlevelNotFound", {
                ns: "customlevel",
                codeOrName,
              })
            );
            return;
          } else if (command == "remove" && rest.length >= 1) {
            const codeOrName = rest.join(" ");
            const fromArguments = custom.fromArguments(codeOrName);
            if (fromArguments != null) {
              const value = custom.get(fromArguments);
              custom.remove(fromArguments);
              custom.save();
              respond(
                i18next.t("customlevelRemoved", {
                  ns: "customlevel",
                  name: value.name,
                  codes: value.codes.join(", "),
                })
              );
              return;
            }
            respond(
              i18next.t("customlevelNotFound", {
                ns: "customlevel",
                codeOrName,
              })
            );
            return;
          } else if (command == "export" && rest.length >= 1) {
            const codeOrName = rest.join(" ");
            const fromArguments = custom.fromArguments(codeOrName);
            if (fromArguments != null) {
              const value = custom.get(fromArguments);
              respond(
                JSON.stringify([fromArguments, value.name, ...value.codes])
              );
              return;
            }
            respond(
              i18next.t("customlevelNotFound", {
                ns: "customlevel",
                codeOrName,
              })
            );
            return;
          } else if (command == "add" && rest.length >= 2) {
            const [code, ...levelNameRest] = rest;
            const levelName = levelNameRest.join(" ");
            const fromName = custom.fromArguments(levelName);
            if (fromName != null) {
              respond(
                i18next.t("customlevelExists", {
                  ns: "customlevel",
                  name: custom.get(fromName).name,
                  codes: custom.get(fromName).codes.join(", "),
                })
              );
              return;
            }
            const fromCode = custom.fromArguments(code);
            if (fromCode != null) {
              respond(
                i18next.t("customlevelCodeExists", {
                  ns: "customlevel",
                  code,
                  name: custom.get(fromCode).name,
                  codes: custom.get(fromCode).codes.join(", "),
                })
              );
              return;
            }
            // new entry!
            const uuid = uuidv4();
            if (custom.has(uuid)) {
              // very very unlikely
              respond(
                i18next.t("customlevelInternalError", { ns: "customlevel" })
              );
              return;
            }
            custom.add(uuid, {
              codes: [code],
              name: levelName,
              enabled: true,
            });
            custom.save();
            respond(
              i18next.t("customlevelAdded", {
                ns: "customlevel",
                levelName,
                code,
              })
            );
            return;
          } else if (command == "import" && rest.length >= 1) {
            console.log(
              "codes:" + JSON.stringify(Object.fromEntries(custom.cache.codes))
            );
            console.log(
              "names:" + JSON.stringify(Object.fromEntries(custom.cache.names))
            );
            const json = rest.join(" ");
            const userData = JSON.parse(json);
            // validate user data
            if (
              !Array.isArray(userData) ||
              userData.length < 3 ||
              !userData.every((data) => typeof data === "string") ||
              !uuidValidate(userData[0])
            ) {
              respond(i18next.t("invalidData", { ns: "customlevel" }));
              return;
            }
            const [uuid, levelName, ...codes] = userData;
            const fromName = custom.fromArguments(levelName);
            if (fromName != null) {
              respond(
                i18next.t("customlevelExists", {
                  ns: "customlevel",
                  name: custom.get(fromName).name,
                  codes: custom.get(fromName).codes.join(", "),
                })
              );
              return;
            }
            for (const code of codes) {
              if (code.indexOf(" ") != -1) {
                // whitespace not allowed in codes!
                respond(i18next.t("invalidData", { ns: "customlevel" }));
                return;
              }
              const fromCode = custom.fromArguments(code);
              if (fromCode != null) {
                respond(
                  i18next.t("customlevelCodeExists", {
                    ns: "customlevel",
                    code,
                    name: custom.get(fromCode).name,
                    codes: custom.get(fromCode).codes.join(", "),
                  })
                );
                return;
              }
            }
            if (custom.has(uuid)) {
              respond(
                i18next.t("customlevelCodeExists", {
                  ns: "customlevel",
                  uuid,
                  name: custom.get(uuid).name,
                  codes: custom.get(uuid).codes.join(", "),
                })
              );
              return;
            }
            custom.add(uuid, {
              codes: codes,
              name: levelName,
              enabled: true,
            });
            custom.save();
            respond(
              i18next.t("customlevelAddedCodes", {
                ns: "customlevel",
                levelName,
                codes: codes.join(", "),
              })
            );
            return;
          } else {
            respond(i18next.t("syntax", { ns: "customlevel" }));
            return;
          }
        }
      } else {
        respond(this.customLevels());
      }
    },
    customLevels: (admin = false) => {
      const list = custom.list(admin);
      if (list.length == 0) {
        return i18next.t("noCustomLevels", { ns: "customlevel" });
      } else if (list.length == 1) {
        return i18next.t("customlevel", {
          ns: "customlevel",
          count: 1,
          list: list[0],
        });
      } else {
        let listString;
        if (list.length == 2) {
          listString = i18next.t("twoLevelsString", {
            ns: "customlevel",
            first: list[0],
            second: list[1],
          });
        } else {
          listString = i18next.t("manyLevelsString", {
            ns: "customlevel",
            first: list.slice(0, -1),
            last: list[-1],
          });
        }
        return i18next.t("customlevel", {
          ns: "customlevel",
          count: list.length,
          list: listString,
        });
      }
    },
  };
};
function upgrade(custom: CustomData) {
  return (code: string) => {
    let uuid = null;
    if (code.startsWith("custom:")) {
      uuid = code.substring("custom:".length);
    }
    if (code == "UNC-LEA-RED" || uuid == UNCLEARED_UUID) {
      custom.addUncleared(false);
      return unclearedLevel();
    } else if (code == "R0M-HAK-LVL" || uuid == ROMHACK_UUID) {
      custom.addRomHack(false);
      return romHackLevel();
    } else if (uuid != null) {
      return { code: uuid, type: "customlevel" };
    }
    return null;
  };
}

const queueHandler = (custom: CustomData) => {
  return {
    check(allEntries: QueueEntry[]) {
      let queueChanged = false;
      if (
        !settings.romhacks_enabled &&
        allEntries.every((level) => !isRomHackLevel(level))
      ) {
        queueChanged = custom.removeRomHack() || queueChanged;
        console.log(i18next.t("romhackRemoved", { ns: "customlevel" }));
      } else {
        queueChanged =
          custom.addRomHack(!!settings.romhacks_enabled) || queueChanged;
        console.log(
          i18next.t("romhackAdded", {
            ns: "customlevel",
            enabled: !!settings.romhacks_enabled,
          })
        );
      }
      if (
        !settings.uncleared_enabled &&
        allEntries.every((level) => !isUnclearedLevel(level))
      ) {
        queueChanged = custom.removeUncleared() || queueChanged;
        console.log(i18next.t("unclearedRemoved", { ns: "customlevel" }));
      } else {
        queueChanged =
          custom.addUncleared(!!settings.uncleared_enabled) || queueChanged;
        console.log(
          i18next.t("unclearedAdded", {
            ns: "customlevel",
            enabled: !!settings.uncleared_enabled,
          })
        );
      }
      return queueChanged;
    },
  };
};

const queueBinding = {
  name: "customlevel",
  version: "1.0",
  empty: {},
  initialize: (data: CustomDataV1) => new CustomTransient(data),
  deserialize(value: PersistedBinding): CustomDataV1 {
    checkVersion(this.version, value.version, this.name);
    return CustomDataV1.parse(value.data);
  },
  serialize(data: CustomDataV1): PersistedBinding {
    return { data, version: this.version };
  },
};

export async function setup(api: ExtensionsApi) {
  const binding = api.createQueueBinding(queueBinding);
  const custom = new CustomData(binding);

  api
    .queueEntry("customlevel", "custom level")
    .usingCode()
    .build(display(custom))
    .registerResolver("customlevel", resolver(custom))
    .registerResolver("customlevel-name", nameResolver(custom))
    .registerUpgrade(upgrade(custom));

  api.registerCommand("customlevel", customlevelCommand(custom));
  api.registerQueueHandler(queueHandler(custom));
}
