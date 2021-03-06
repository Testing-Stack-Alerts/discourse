import {
  START_OF_DAY_HOUR,
  laterToday,
  now,
  parseCustomDatetime,
} from "discourse/lib/time-utils";
import {
  TIME_SHORTCUT_TYPES,
  defaultShortcutOptions,
} from "discourse/lib/time-shortcut";
import discourseComputed, {
  observes,
  on,
} from "discourse-common/utils/decorators";

import Component from "@ember/component";
import I18n from "I18n";
import KeyboardShortcuts from "discourse/lib/keyboard-shortcuts";
import { action } from "@ember/object";
import { and, equal } from "@ember/object/computed";

// global shortcuts that interfere with these modal shortcuts, they are rebound when the
// component is destroyed
//
// c createTopic
// r replyToPost
// l toggle like
// t replyAsNewTopic
const GLOBAL_SHORTCUTS_TO_PAUSE = ["c", "r", "l", "t"];
const BINDINGS = {
  "l t": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.LATER_TODAY],
  },
  "l w": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.LATER_THIS_WEEK],
  },
  "n d": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.TOMORROW],
  },
  "n w": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.NEXT_WEEK],
  },
  "n b w": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.START_OF_NEXT_BUSINESS_WEEK],
  },
  "n m": {
    handler: "selectShortcut",
    args: [TIME_SHORTCUT_TYPES.NEXT_MONTH],
  },
  "c r": { handler: "selectShortcut", args: [TIME_SHORTCUT_TYPES.CUSTOM] },
  "n r": { handler: "selectShortcut", args: [TIME_SHORTCUT_TYPES.NONE] },
};

export default Component.extend({
  tagName: "",

  userTimezone: null,

  onTimeSelected: null,

  selectedShortcut: null,
  selectedTime: null,
  selectedDate: null,
  selectedDatetime: null,
  prefilledDatetime: null,

  additionalOptionsToShow: null,
  hiddenOptions: null,
  customOptions: null,

  lastCustomDate: null,
  lastCustomTime: null,
  parsedLastCustomDatetime: null,
  customDate: null,
  customTime: null,

  defaultCustomReminderTime: `0${START_OF_DAY_HOUR}:00`,

  @on("init")
  _setupPicker() {
    this.setProperties({
      customTime: this.defaultCustomReminderTime,
      userTimezone: this.currentUser.resolvedTimezone(this.currentUser),
      additionalOptionsToShow: this.additionalOptionsToShow || [],
      hiddenOptions: this.hiddenOptions || [],
      customOptions: this.customOptions || [],
    });

    if (this.prefilledDatetime) {
      this.parsePrefilledDatetime();
    }

    this._bindKeyboardShortcuts();
    this._loadLastUsedCustomDatetime();
  },

  @observes("prefilledDatetime")
  prefilledDatetimeChanged() {
    if (this.prefilledDatetime) {
      this.parsePrefilledDatetime();
    } else {
      this.setProperties({
        customDate: null,
        customTime: null,
        selectedShortcut: null,
      });
    }
  },

  @on("willDestroyElement")
  _resetKeyboardShortcuts() {
    KeyboardShortcuts.unbind(BINDINGS);
    KeyboardShortcuts.unpause(GLOBAL_SHORTCUTS_TO_PAUSE);
  },

  parsePrefilledDatetime() {
    let parsedDatetime = parseCustomDatetime(
      this.prefilledDatetime,
      null,
      this.userTimezone
    );

    if (parsedDatetime.isSame(laterToday())) {
      return this.set("selectedShortcut", TIME_SHORTCUT_TYPES.LATER_TODAY);
    }

    this.setProperties({
      customDate: parsedDatetime.format("YYYY-MM-DD"),
      customTime: parsedDatetime.format("HH:mm"),
      selectedShortcut: TIME_SHORTCUT_TYPES.CUSTOM,
    });
  },

  _loadLastUsedCustomDatetime() {
    let lastTime = localStorage.lastCustomTime;
    let lastDate = localStorage.lastCustomDate;

    if (lastTime && lastDate) {
      let parsed = parseCustomDatetime(lastDate, lastTime, this.userTimezone);

      if (parsed < now(this.userTimezone)) {
        return;
      }

      this.setProperties({
        lastCustomDate: lastDate,
        lastCustomTime: lastTime,
        parsedLastCustomDatetime: parsed,
      });
    }
  },

  _bindKeyboardShortcuts() {
    KeyboardShortcuts.pause(GLOBAL_SHORTCUTS_TO_PAUSE);
    Object.keys(BINDINGS).forEach((shortcut) => {
      KeyboardShortcuts.addShortcut(shortcut, () => {
        let binding = BINDINGS[shortcut];
        if (binding.args) {
          return this.send(binding.handler, ...binding.args);
        }
        this.send(binding.handler);
      });
    });
  },

  customDatetimeSelected: equal("selectedShortcut", TIME_SHORTCUT_TYPES.CUSTOM),
  customDatetimeFilled: and("customDate", "customTime"),

  @observes("customDate", "customTime")
  customDatetimeChanged() {
    if (!this.customDatetimeFilled) {
      return;
    }
    this.selectShortcut(TIME_SHORTCUT_TYPES.CUSTOM);
  },

  @discourseComputed(
    "additionalOptionsToShow",
    "hiddenOptions",
    "customOptions",
    "userTimezone"
  )
  options(additionalOptionsToShow, hiddenOptions, customOptions, userTimezone) {
    let options = defaultShortcutOptions(userTimezone);

    if (additionalOptionsToShow.length > 0) {
      options.forEach((opt) => {
        if (additionalOptionsToShow.includes(opt.id)) {
          opt.hidden = false;
        }
      });
    }

    if (hiddenOptions.length > 0) {
      options.forEach((opt) => {
        if (hiddenOptions.includes(opt.id)) {
          opt.hidden = true;
        }
      });
    }

    if (this.lastCustomDate && this.lastCustomTime) {
      let lastCustom = options.findBy("id", TIME_SHORTCUT_TYPES.LAST_CUSTOM);
      lastCustom.time = this.parsedLastCustomDatetime;
      lastCustom.timeFormatted = this.parsedLastCustomDatetime.format(
        I18n.t("dates.long_no_year")
      );
      lastCustom.hidden = false;
    }

    customOptions.forEach((opt) => {
      if (!opt.timeFormatted && opt.time) {
        opt.timeFormatted = opt.time.format(I18n.t(opt.timeFormatKey));
      }
    });

    let customOptionIndex = options.findIndex(
      (opt) => opt.id === TIME_SHORTCUT_TYPES.CUSTOM
    );

    options.splice(customOptionIndex, 0, ...customOptions);

    return options;
  },

  @action
  selectShortcut(type) {
    if (this.options.filterBy("hidden").mapBy("id").includes(type)) {
      return;
    }

    let dateTime = null;
    if (type === TIME_SHORTCUT_TYPES.CUSTOM) {
      this.set("customTime", this.customTime || this.defaultCustomReminderTime);
      const customDatetime = parseCustomDatetime(
        this.customDate,
        this.customTime,
        this.userTimezone
      );

      if (customDatetime.isValid()) {
        dateTime = customDatetime;

        localStorage.lastCustomTime = this.customTime;
        localStorage.lastCustomDate = this.customDate;
      }
    } else {
      dateTime = this.options.findBy("id", type).time;
    }

    this.setProperties({
      selectedShortcut: type,
      selectedDatetime: dateTime,
    });

    if (this.onTimeSelected) {
      this.onTimeSelected(type, dateTime);
    }
  },
});
