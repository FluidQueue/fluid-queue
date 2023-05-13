(await import("./banner.js")).printBanner();
(await import("./persistence.js")).setup();
import { quesoqueue as queue } from "./queue.js";
import { twitch } from "./twitch.js";
import { timer, Timer } from "./timer.js";
import * as aliasManagement from "./aliases.js";
import { twitchApi } from "./twitch-api.js";
import settings from "./settings.js";
import { helper } from "./chatbot.js";
import { QueueEntry } from "./extensions-api/queue-entry.js";
import { Chatter, Responder } from "./extensions-api/command.js";

const quesoqueue = queue();
const aliases = aliasManagement.aliases();
aliases.loadAliases();

let queue_open = settings.start_open;
let selection_iter = 0;
let level_timer: Timer | null = null;

if (settings.level_timeout) {
  level_timer = timer(() => {
    chatbot_helper.say(
      `@${settings.channel} the timer has expired for this level!`
    );
  }, settings.level_timeout * 1000 * 60);
}

function get_remainder(x: string) {
  const index = x.indexOf(" ");
  if (index == -1) {
    return "";
  }
  return x.substring(index + 1).trim();
}

let can_list = true;

function next_level_message(level: QueueEntry | undefined) {
  if (level === undefined) {
    return "The queue is empty.";
  }
  twitch.notLurkingAnymore(level.submitter); // If we pull up a level, we should reset the lurking status
  return `Now playing ${level} submitted by ${level.submitter}.`;
}

function weightedrandom_level_message(
  level: (QueueEntry & { selectionChance: string }) | undefined,
  percentSuffix = ""
) {
  if (level === undefined) {
    return "The queue is empty.";
  }
  twitch.notLurkingAnymore(level.submitter); // If we pull up a level, we should reset the lurking status
  return `Now playing ${level} submitted by ${level.submitter} with a ${level.selectionChance}%${percentSuffix} chance of selection.`;
}

function weightednext_level_message(
  level: (QueueEntry & { selectionChance: string }) | undefined,
  percentSuffix = ""
) {
  if (level === undefined) {
    return "The queue is empty.";
  }
  twitch.notLurkingAnymore(level.submitter); // If we pull up a level, we should reset the lurking status
  return `Now playing ${level} submitted by ${level.submitter} with the highest wait time of ${level.selectionChance}%${percentSuffix}.`;
}

function current_level_message(level: QueueEntry | undefined) {
  if (level === undefined) {
    return "We're not playing a level right now!";
  }
  return `Currently playing ${level} submitted by ${level.submitter}.`;
}

function get_ordinal(num: number): string {
  const ends = ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"];
  if (num % 100 >= 11 && num % 100 <= 13) {
    return num + "th";
  }
  return num + ends[num % 10];
}

const hasPosition = () => {
  return (
    settings.position == "both" ||
    settings.position == "position" ||
    (settings.position == null &&
      (settings.level_selection.includes("next") ||
        !settings.level_selection.includes("weightednext")))
  );
};

const hasWeightedPosition = () => {
  return (
    settings.position == "both" ||
    settings.position == "weight" ||
    (settings.position == null &&
      settings.level_selection.includes("weightednext"))
  );
};

const hasPositionList = () => {
  return (
    settings.list == "both" ||
    settings.list == "position" ||
    (settings.list == null &&
      (settings.level_selection.includes("next") ||
        !settings.level_selection.includes("weightednext")))
  );
};

const hasWeightList = () => {
  return (
    settings.list == "both" ||
    settings.list == "weight" ||
    (settings.list == null && settings.level_selection.includes("weightednext"))
  );
};

const position_message = async (
  position: number,
  weightedPosition: number,
  sender: Chatter
) => {
  if (position == -1) {
    return (
      sender + ", looks like you're not in the queue. Try !add XXX-XXX-XXX."
    );
  } else if (position === 0) {
    return "Your level is being played right now!";
  } else if (position === -3) {
    // show only weighted position!
    if (weightedPosition == -1) {
      return (
        sender + ", looks like you're not in the queue. Try !add XXX-XXX-XXX."
      );
    } else if (weightedPosition === 0) {
      return "Your level is being played right now!";
    } else if (weightedPosition == -2) {
      return (
        sender +
        ", you are in a BRB state, so you cannot be selected in weighted next. Try using !back and then checking again."
      );
    } else if (weightedPosition == -3) {
      // none
      return "";
    }
    return (
      sender +
      ", you are currently in the weighted " +
      get_ordinal(weightedPosition) +
      " position."
    );
  }
  if (settings.enable_absolute_position) {
    const absPosition = await quesoqueue.absolutePosition(sender);
    if (weightedPosition > 0) {
      return (
        sender +
        ", you are currently in the online " +
        get_ordinal(position) +
        " position, the offline " +
        get_ordinal(absPosition) +
        " position, and the weighted " +
        get_ordinal(weightedPosition) +
        " position."
      );
    } else {
      return (
        sender +
        ", you are currently in the online " +
        get_ordinal(position) +
        " position and the offline " +
        get_ordinal(absPosition) +
        " position."
      );
    }
  } else {
    if (weightedPosition > 0) {
      return (
        sender +
        ", you are currently in the " +
        get_ordinal(position) +
        " position and the weighted " +
        get_ordinal(weightedPosition) +
        " position."
      );
    } else {
      return (
        sender +
        ", you are currently in the " +
        get_ordinal(position) +
        " position."
      );
    }
  }
};

const weightedchance_message = async (
  chance: string | number,
  multiplier: number,
  sender: Chatter
) => {
  if (chance == -1) {
    return (
      sender + ", looks like you're not in the queue. Try !add XXX-XXX-XXX."
    );
  } else if (chance == -2) {
    return (
      sender +
      ", you are in a BRB state, so you cannot be selected in weighted random. Try using !back and then checking again."
    );
  } else if (chance === 0) {
    return "Your level is being played right now!";
  }
  return (
    sender +
    ", you have a " +
    chance +
    "% chance of getting chosen in weighted random." +
    (multiplier > 1.0 ? " (" + multiplier.toFixed(1) + " multiplier)" : "")
  );
};

const submitted_message = async (
  level: QueueEntry | number,
  sender: Chatter
) => {
  if (level === 0) {
    return "Your level is being played right now!";
  } else if (typeof level === "number") {
    return (
      sender + ", looks like you're not in the queue. Try !add XXX-XXX-XXX."
    );
  }
  return sender + ", you have submitted " + level + " to the queue.";
};

const submitted_mod_message = async (
  submitted:
    | { result: "no-submitter" | "not-found" }
    | { result: "current" | "level"; level: QueueEntry },
  usernameArgument: string
) => {
  if (submitted.result == "current") {
    return `${submitted.level.submitter}'s level is being played right now!`;
  } else if (submitted.result == "not-found") {
    return `${usernameArgument} is not in the queue.`;
  } else if (submitted.result == "level") {
    return (
      submitted.level.submitter +
      " has submitted " +
      submitted.level +
      " to the queue."
    );
  }

  return "You can use !submitted <username> to view someones entry.";
};

// What the bot should do when someone sends a message in chat.
// `message` is the full text of the message. `sender` is the username
// of the person that sent the message.

async function HandleMessage(
  message: string,
  sender: Chatter,
  respond: Responder
) {
  twitch.noticeChatter(sender);

  const argsArray = message.split(" ");
  let cmd = argsArray.shift();
  cmd = cmd?.toLowerCase();
  const args = argsArray.join(" ");
  if (args.length == 0) {
    message = cmd ?? "";
  } else {
    message = (cmd ?? "") + " " + args;
  }

  if (message.toLowerCase().startsWith("!addalias") && sender.isBroadcaster) {
    if (message.split(" ").length !== 3) {
      respond(
        "The syntax for adding an alias is: !addAlias command alias, for example: !addAlias open op"
      );
    } else {
      const splitMessage = message.split(" ");
      if (
        aliases.addAlias(
          splitMessage[1].startsWith("!")
            ? splitMessage[1].toLowerCase().substring(1)
            : splitMessage[1].toLowerCase(),
          splitMessage[2]
        )
      ) {
        respond(
          "Alias " +
            splitMessage[2] +
            " for command " +
            splitMessage[1] +
            " has been added."
        );
      } else {
        if (!aliases.isCommand(splitMessage[1].toLowerCase())) {
          const commands = aliases.getCommands().join(" ");
          respond(
            "The command entered is invalid. Valid commands are: " + commands
          );
        } else if (aliases.isDisabled(splitMessage[1].toLowerCase())) {
          respond("The command " + splitMessage[1] + " is currently disabled.");
        } else {
          respond(
            "The alias " + splitMessage[2] + " has already been assigned."
          );
        }
      }
    }
  } else if (
    message.toLowerCase().startsWith("!removealias") &&
    sender.isBroadcaster
  ) {
    if (message.split(" ").length !== 3) {
      respond(
        "The syntax for removing an alias is: !removealias command alias, for example: !removealias open op"
      );
    } else {
      const splitMessage = message.split(" ");
      if (
        aliases.removeAlias(
          splitMessage[1].startsWith("!")
            ? splitMessage[1].toLowerCase().substring(1)
            : splitMessage[1].toLowerCase(),
          splitMessage[2].startsWith("!")
            ? splitMessage[2]
            : "!" + splitMessage[2]
        )
      ) {
        respond(
          "Alias " +
            splitMessage[2] +
            " for command " +
            splitMessage[1] +
            " has been removed."
        );
      } else {
        if (!aliases.isCommand(splitMessage[1].toLowerCase())) {
          const commands = aliases.getCommands().join(" ");
          respond(
            "The command entered is invalid. Valid commands are: " + commands
          );
        } else if (aliases.isDisabled(splitMessage[1].toLowerCase())) {
          respond("The command " + splitMessage[1] + " is currently disabled.");
        } else {
          respond(
            "The alias " +
              splitMessage[2] +
              " does not exist for command " +
              splitMessage[1] +
              "."
          );
        }
      }
    }
  } else if (
    (message.toLowerCase().startsWith("!enablecmd") ||
      message.toLowerCase().startsWith("!disablecmd") ||
      message.toLowerCase().startsWith("!resetcmd")) &&
    sender.isBroadcaster
  ) {
    if (message.split(" ").length !== 2) {
      respond(
        "The syntax for enabling, disabling and resetting commands is: !command botcommand, for example: !enablecmd open"
      );
    } else {
      const splitMessage = message.split(" ");
      if (splitMessage[0].toLowerCase() === "!enablecmd") {
        if (
          aliases.enableCommand(
            splitMessage[1].startsWith("!")
              ? splitMessage[1].toLowerCase().substring(1)
              : splitMessage[1].toLowerCase()
          )
        ) {
          // if the command starts with "!" - remove the "!".
          respond(
            "The command " + splitMessage[1] + " has been successfully enabled."
          );
        } else {
          if (
            !aliases.isCommand(
              splitMessage[1].startsWith("!")
                ? splitMessage[1].toLowerCase().substring(1)
                : splitMessage[1].toLowerCase()
            )
          ) {
            const commands = aliases.getCommands().join(" ");
            respond(
              "The command entered is invalid. Valid commands are: " + commands
            );
          } else {
            respond("The command " + splitMessage[1] + " is already enabled.");
          }
        }
      } else if (splitMessage[0].toLowerCase() === "!disablecmd") {
        if (
          aliases.disableCommand(
            splitMessage[1].startsWith("!")
              ? splitMessage[1].toLowerCase().substring(1)
              : splitMessage[1].toLowerCase()
          )
        ) {
          // if the command starts with "!" - remove the "!".
          respond(
            "The command " +
              splitMessage[1] +
              " has been successfully disabled."
          );
        } else {
          if (
            !aliases.isCommand(
              splitMessage[1].startsWith("!")
                ? splitMessage[1].toLowerCase().substring(1)
                : splitMessage[1].toLowerCase()
            )
          ) {
            const commands = aliases.getCommands().join(" ");
            respond(
              "The command entered is invalid. Valid commands are: " + commands
            );
          } else {
            respond("The command " + splitMessage[1] + " is already disabled.");
          }
        }
      } else if (splitMessage[0] === "!resetcmd") {
        if (
          aliases.resetCommand(
            splitMessage[1].startsWith("!")
              ? splitMessage[1].toLowerCase().substring(1)
              : splitMessage[1].toLowerCase()
          )
        ) {
          // if the command starts with "!" - remove the "!".
          respond(
            "The command " + splitMessage[1] + " has been successfully reset."
          );
        } else {
          if (
            !aliases.isCommand(
              splitMessage[1].startsWith("!")
                ? splitMessage[1].toLowerCase().substring(1)
                : splitMessage[1].toLowerCase()
            )
          ) {
            const commands = aliases.getCommands().join(" ");
            respond(
              "The command entered is invalid. Valid commands are: " + commands
            );
          }
        }
      }
    }
  } else if (
    message.toLowerCase().startsWith("!aliases") &&
    sender.isBroadcaster
  ) {
    respond(
      "Availabe aliases commands are: !addAlias command alias - !enablecmd command - !disablecmd command - !resetcmd command"
    );
    const commands = aliases.getCommands().join(" ");
    respond("Available commands are: " + commands);
  } else if (aliases.isAlias("open", message) && sender.isBroadcaster) {
    queue_open = true;
    respond("The queue is now open!");
  } else if (aliases.isAlias("close", message) && sender.isBroadcaster) {
    queue_open = false;
    respond("The queue is now closed!");
  } else if (aliases.isAlias("add", message)) {
    if (queue_open || sender.isBroadcaster) {
      // If they just added their level, it's a safe bet they aren't lurking
      if (twitch.notLurkingAnymore(sender)) {
        // But to avoid confusion, we can welcome them back too
        respond("Welcome back, " + sender.displayName + "!");
      }
      const level_code = get_remainder(message);
      respond(quesoqueue.add(level_code, sender));
    } else {
      respond("Sorry, the queue is closed right now.");
    }
  } else if (aliases.isAlias("remove", message)) {
    const to_remove = get_remainder(message);
    if (sender.isBroadcaster && to_remove != "") {
      respond(quesoqueue.modRemove(to_remove));
    } else {
      // if they're leaving, they're not lurking
      twitch.notLurkingAnymore(sender);
      respond(quesoqueue.remove(sender));
    }
  } else if (aliases.isAlias("replace", message)) {
    const level_code = get_remainder(message);
    // If they just added their level, it's a safe bet they aren't lurking
    if (twitch.notLurkingAnymore(sender)) {
      // But to avoid confusion, we can welcome them back too
      respond("Welcome back, " + sender.displayName + "!");
    }
    respond(quesoqueue.replace(sender, level_code));
  } else if (aliases.isAlias("level", message) && sender.isBroadcaster) {
    let next_level;
    let selection_mode =
      settings.level_selection[
        selection_iter++ % settings.level_selection.length
      ];
    if (selection_iter >= settings.level_selection.length) {
      selection_iter = 0;
    }
    switch (selection_mode) {
      case "next":
        next_level = await quesoqueue.next();
        break;
      case "subnext":
        next_level = await quesoqueue.subnext();
        break;
      case "modnext":
        next_level = await quesoqueue.modnext();
        break;
      case "random":
        next_level = await quesoqueue.random();
        break;
      case "subrandom":
        next_level = await quesoqueue.subrandom();
        break;
      case "modrandom":
        next_level = await quesoqueue.modrandom();
        break;
      case "weightedrandom":
        next_level = await quesoqueue.weightedrandom();
        respond(
          "(" + selection_mode + ") " + weightedrandom_level_message(next_level)
        );
        break;
      case "weightednext":
        next_level = await quesoqueue.weightednext();
        respond(
          "(" + selection_mode + ") " + weightednext_level_message(next_level)
        );
        break;
      case "weightedsubrandom":
        next_level = await quesoqueue.weightedsubrandom();
        respond(
          "(" +
            selection_mode +
            ") " +
            weightedrandom_level_message(next_level, " (subscriber)")
        );
        break;
      case "weightedsubnext":
        next_level = await quesoqueue.weightedsubnext();
        respond(
          "(" +
            selection_mode +
            ") " +
            weightednext_level_message(next_level, " (subscriber)")
        );
        break;
      default:
        selection_mode = "default";
        next_level = await quesoqueue.next();
    }
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    if (
      selection_mode != "weightedrandom" &&
      selection_mode != "weightednext" &&
      selection_mode != "weightedsubrandom" &&
      selection_mode != "weightedsubnext"
    ) {
      respond("(" + selection_mode + ") " + next_level_message(next_level));
    }
  } else if (aliases.isAlias("next", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.next();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("subnext", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.subnext();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("modnext", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.modnext();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("random", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.random();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("weightednext", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.weightednext();
    respond(weightednext_level_message(next_level));
  } else if (
    aliases.isAlias("weightedrandom", message) &&
    sender.isBroadcaster
  ) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.weightedrandom();
    respond(weightedrandom_level_message(next_level));
  } else if (
    aliases.isAlias("weightedsubnext", message) &&
    sender.isBroadcaster
  ) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.weightedsubnext();
    respond(weightednext_level_message(next_level, " (subscriber)"));
  } else if (
    aliases.isAlias("weightedsubrandom", message) &&
    sender.isBroadcaster
  ) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.weightedsubrandom();
    respond(weightedrandom_level_message(next_level, " (subscriber)"));
  } else if (aliases.isAlias("subrandom", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.subrandom();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("modrandom", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const next_level = await quesoqueue.modrandom();
    respond(next_level_message(next_level));
  } else if (aliases.isAlias("punt", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    respond(await quesoqueue.punt());
  } else if (aliases.isAlias("dismiss", message) && sender.isBroadcaster) {
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    respond(await quesoqueue.dismiss());
  } else if (aliases.isAlias("select", message) && sender.isBroadcaster) {
    const username = get_remainder(message);
    if (settings.level_timeout && level_timer != null) {
      level_timer.restart();
      level_timer.pause();
    }
    const dip_level = quesoqueue.dip(username);
    if (dip_level !== undefined) {
      twitch.notLurkingAnymore(dip_level.submitter);
      respond(
        "Now playing " +
          dip_level +
          " submitted by " +
          dip_level.submitter +
          "."
      );
    } else {
      respond("No levels in the queue were submitted by " + username + ".");
    }
  } else if (aliases.isAlias("current", message)) {
    respond(current_level_message(quesoqueue.current()));
  } else if (aliases.isAlias("list", message)) {
    let do_list = false;
    const list_position = hasPositionList();
    const list_weight = hasWeightList();
    if (!list_position && !list_weight) {
      // do nothing
    } else if (settings.message_cooldown) {
      if (can_list) {
        can_list = false;
        setTimeout(() => (can_list = true), settings.message_cooldown * 1000);
        do_list = true;
      } else {
        respond("Scroll up to see the queue.");
      }
    } else {
      do_list = true;
    }
    if (do_list) {
      if (list_position) {
        respond(await quesoqueue.level_list_message());
      }
      if (list_weight) {
        respond(await quesoqueue.level_weighted_list_message());
      }
    }
  } else if (aliases.isAlias("position", message)) {
    const list = await quesoqueue.list();
    respond(
      await position_message(
        hasPosition() ? await quesoqueue.position(sender, list) : -3,
        hasWeightedPosition()
          ? await quesoqueue.weightedPosition(sender, list)
          : -3,
        sender
      )
    );
  } else if (aliases.isAlias("weightedchance", message)) {
    respond(
      await weightedchance_message(
        await quesoqueue.weightedchance(sender),
        quesoqueue.multiplier(sender),
        sender
      )
    );
  } else if (aliases.isAlias("submitted", message)) {
    const usernameArgument = get_remainder(message);
    if ((sender.isMod || sender.isBroadcaster) && usernameArgument != "") {
      respond(
        await submitted_mod_message(
          quesoqueue.modSubmittedLevel(usernameArgument),
          usernameArgument
        )
      );
    } else {
      respond(
        await submitted_message(await quesoqueue.submittedlevel(sender), sender)
      );
    }
  } else if (
    settings.level_timeout &&
    level_timer != null &&
    aliases.isAlias("start", message) &&
    sender.isBroadcaster
  ) {
    level_timer.resume();
    respond("Timer started! Get going!");
  } else if (
    settings.level_timeout &&
    level_timer != null &&
    aliases.isAlias("resume", message) &&
    sender.isBroadcaster
  ) {
    level_timer.resume();
    respond("Timer unpaused! Get going!");
  } else if (
    settings.level_timeout &&
    level_timer != null &&
    aliases.isAlias("pause", message) &&
    sender.isBroadcaster
  ) {
    level_timer.pause();
    respond("Timer paused");
  } else if (
    settings.level_timeout &&
    level_timer != null &&
    aliases.isAlias("restart", message) &&
    sender.isBroadcaster
  ) {
    level_timer.restart();
    respond("Starting the clock over! CP Hype!");
  } else if (aliases.isAlias("persistence", message) && sender.isBroadcaster) {
    const subCommand = get_remainder(message);
    const response = await quesoqueue.persistenceManagement(subCommand);
    console.log(subCommand);
    console.log(response);
    respond(`@${sender.displayName} ${response}`);
  } else if (aliases.isAlias("clear", message) && sender.isBroadcaster) {
    const clearArgument = get_remainder(message);
    const response = await quesoqueue.clear(clearArgument, respond);
    respond(response);
  } else if (aliases.isAlias("brb", message)) {
    twitch.setToLurk(sender);
    respond(
      "See you later, " +
        sender.displayName +
        "! Your level will not be played until you use the !back command."
    );
  } else if (aliases.isAlias("back", message)) {
    if (twitch.notLurkingAnymore(sender)) {
      respond("Welcome back, " + sender.displayName + "!");
    }
  } else if (aliases.isAlias("order", message)) {
    if (settings.level_selection.length === 0) {
      respond("No order has been specified.");
    } else {
      const nextIndex = selection_iter % settings.level_selection.length;
      let order = [...settings.level_selection]; // copy array
      order = order.concat(order.splice(0, nextIndex)); // shift array to the left by nextIndex positions
      respond("Next level order: " + order.reduce((acc, x) => acc + ", " + x));
    }
  } else {
    return await quesoqueue.handleCommands(message, sender, respond);
  }
}

// Set up the chatbot helper
const chatbot_helper = helper(settings.channel);
chatbot_helper.setup(HandleMessage);

// run async code
// setup the twitch api
await twitchApi.setup();

// loading the queue
await quesoqueue.load();

// connect to the Twitch channel.
await chatbot_helper.connect();
