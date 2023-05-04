// imports
import { jest } from "@jest/globals";
import {
  simAdvanceTime,
  simRequireIndex,
  buildChatter,
  simSetChatters,
  createMockVolume,
  START_TIME,
  EMPTY_CHATTERS,
  DEFAULT_TEST_SETTINGS,
} from "./simulation.js";
import { Queue, QueueDataMap, WeightedList } from "../src/queue.js";

// console checks
const consoleWarnMock = jest.spyOn(global.console, "warn");
const consoleErrorMock = jest.spyOn(global.console, "error");

jest.useFakeTimers();

const setupMocks = () => {
  // reset chatters
  simSetChatters(EMPTY_CHATTERS);

  // reset time
  jest.setSystemTime(START_TIME);

  // reset console
  consoleWarnMock.mockClear();
  consoleErrorMock.mockClear();
};

beforeEach(setupMocks);
test("weight test", async () => {
  const volume = createMockVolume();
  const index = await simRequireIndex(
    volume,
    DEFAULT_TEST_SETTINGS,
    START_TIME,
    setupMocks
  );
  const queue: Queue = index.quesoqueue;
  if (queue.testAccess === undefined) {
    throw new Error("testAccess is undefined");
  }
  const twitch = index.twitch;

  let getList: QueueDataMap<WeightedList>;
  getList = await queue.weightedList();
  queue.testAccess((data) => {
    const list = getList(data);
    expect(list.totalWeight).toBe(0);
    expect(list.offlineLength).toBe(0);
    expect(list.entries).toHaveLength(0);
  });

  const testUser1 = buildChatter("test_user_1", "にゃん", false, false, false);
  const testUser2 = buildChatter("test_user_2", "にゃ", false, false, false);
  const testUser3 = buildChatter("test_user_3", "みゃ", false, false, false);

  const level1 = "D36-010-5YF";
  const level2 = "MY2-H2M-DSG";
  const level3 = "GBJ-6QY-P8G";

  let added;
  added = queue.add(level1, testUser1);
  expect(added).toContain("has been added to the queue");
  added = queue.add(level2, testUser2);
  expect(added).toContain("has been added to the queue");
  added = queue.add(level3, testUser3);
  expect(added).toContain("has been added to the queue");

  // no one is online yet!
  getList = await queue.weightedList();
  queue.testAccess((data) => {
    const list = getList(data);
    expect(list.totalWeight).toBe(0);
    expect(list.offlineLength).toBe(3);
    expect(list.entries).toHaveLength(0);
  });

  // user 2 is now online
  twitch.noticeChatter(testUser2);

  getList = await queue.weightedList();
  queue.testAccess((data) => {
    const list = getList(data);
    expect(list.totalWeight).toBe(1);
    expect(list.offlineLength).toBe(2);
    expect(list.entries).toHaveLength(1);
    const entry = list.entries[0];
    expect(entry.level.serializePersistedQueueEntry()).toEqual({
      submitter: {
        id: testUser2.id,
        name: testUser2.name,
        displayName: testUser2.displayName,
      },
      type: "smm2",
      code: level2,
      data: undefined,
    });
    // position is 0 even though its oflline position is 1 (index), but it is position 0 for the online position
    expect(entry.position).toBe(0);
    expect(entry.weight()).toBe(1);
  });

  // keep user 2 online
  simSetChatters([testUser2]);

  // let time pass! 10 minutes
  await simAdvanceTime(10 * 60 * 1000, 60 * 1000);

  // now user 1 is online too
  twitch.noticeChatter(testUser1);

  getList = await queue.weightedList();
  queue.testAccess((data) => {
    const list = getList(data);
    expect(list.totalWeight).toBe(12); // total weight is now 12
    expect(list.offlineLength).toBe(1);
    expect(list.entries).toHaveLength(2);
    let entry = list.entries[0];
    expect(entry.level.serializePersistedQueueEntry()).toEqual({
      submitter: {
        id: testUser2.id,
        name: testUser2.name,
        displayName: testUser2.displayName,
      },
      type: "smm2",
      code: level2,
      data: undefined,
    });
    expect(entry.position).toBe(1); // level 1 was submitted before level 2
    expect(entry.weight()).toBe(11); // gained +10 weight
    entry = list.entries[1];
    expect(entry.level.serializePersistedQueueEntry()).toEqual({
      submitter: {
        id: testUser1.id,
        name: testUser1.name,
        displayName: testUser1.displayName,
      },
      type: "smm2",
      code: level1,
      data: undefined,
    });
    expect(entry.position).toBe(0); // level 1 was submitted before level 2
    expect(entry.weight()).toBe(1);
  });
});
