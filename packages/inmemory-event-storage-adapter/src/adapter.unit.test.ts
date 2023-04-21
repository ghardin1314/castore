/* eslint-disable max-lines */
import { randomUUID } from 'crypto';
import omit from 'lodash.omit';
import MockDate from 'mockdate';

import { GroupedEvent, StorageAdapter } from '@castore/core';

import { InMemoryStorageAdapter } from './adapter';
import { InMemoryEventAlreadyExistsError } from './error';

const eventStoreId = 'eventStoreId';

const aggregateIdMock1 = randomUUID();
const aggregateIdMock2 = randomUUID();
const aggregateIdMock3 = randomUUID();
const aggregateIdMock4 = randomUUID();
const eventMock1 = {
  aggregateId: aggregateIdMock1,
  version: 1,
  type: 'EVENT_TYPE',
  timestamp: '2021-01-01T00:00:00.000Z',
};
const eventMock2 = {
  aggregateId: aggregateIdMock1,
  version: 2,
  type: 'EVENT_TYPE',
  timestamp: '2022-01-01T00:00:00.000Z',
};

describe('in-memory storage adapter', () => {
  describe('constructor', () => {
    const storageAdapter = new InMemoryStorageAdapter({
      initialEvents: [eventMock1, eventMock2],
    });

    it('fills the db with initial events', () => {
      expect(storageAdapter.eventStore).toStrictEqual({
        [aggregateIdMock1]: [eventMock1, eventMock2],
      });
    });
  });

  describe('methods', () => {
    describe('getEvents', () => {
      const storageAdapter = new InMemoryStorageAdapter();

      it('gets an empty array if there is no event for aggregateId', async () => {
        const response = await storageAdapter.getEvents(aggregateIdMock1);
        expect(response).toStrictEqual({ events: [] });
      });

      it('throws an error if version already exists', async () => {
        const { timestamp, ...event } = eventMock1;
        MockDate.set(timestamp);
        await storageAdapter.pushEvent(event, { eventStoreId });

        await expect(() =>
          storageAdapter.pushEvent(eventMock1, { eventStoreId }),
        ).rejects.toThrow(InMemoryEventAlreadyExistsError);
      });

      it('pushes and gets events correctly', async () => {
        const { timestamp, ...event } = eventMock2;
        MockDate.set(timestamp);
        await storageAdapter.pushEvent(event, { eventStoreId });

        const allEvents = await storageAdapter.getEvents(aggregateIdMock1);
        expect(allEvents).toStrictEqual({ events: [eventMock1, eventMock2] });

        const eventsMaxVersion = await storageAdapter.getEvents(
          aggregateIdMock1,
          { maxVersion: 1 },
        );
        expect(eventsMaxVersion).toStrictEqual({ events: [eventMock1] });

        const eventsMinVersion = await storageAdapter.getEvents(
          aggregateIdMock1,
          { minVersion: 2 },
        );
        expect(eventsMinVersion).toStrictEqual({ events: [eventMock2] });

        const eventsLimit = await storageAdapter.getEvents(aggregateIdMock1, {
          limit: 1,
        });
        expect(eventsLimit).toStrictEqual({ events: [eventMock1] });

        const eventsReverse = await storageAdapter.getEvents(aggregateIdMock1, {
          reverse: true,
        });
        expect(eventsReverse).toStrictEqual({
          events: [eventMock2, eventMock1],
        });

        const eventsReverseAndLimit = await storageAdapter.getEvents(
          aggregateIdMock1,
          { limit: 1, reverse: true },
        );
        expect(eventsReverseAndLimit).toStrictEqual({ events: [eventMock2] });
      });
    });

    describe('listAggregateIds', () => {
      const storageAdapter = new InMemoryStorageAdapter();

      it('list aggregate Ids', async () => {
        const { timestamp, ...event } = eventMock1;
        MockDate.set(timestamp);
        await storageAdapter.pushEvent(event, { eventStoreId });

        const aggregate2InitialEventTimestamp = '2022-01-01T00:00:00.000Z';
        MockDate.set(aggregate2InitialEventTimestamp);
        await storageAdapter.pushEvent(
          { version: 1, type: 'EVENT_TYPE', aggregateId: aggregateIdMock2 },
          { eventStoreId },
        );

        const aggregateIds = await storageAdapter.listAggregateIds();

        expect(aggregateIds).toStrictEqual({
          aggregateIds: [aggregateIdMock1, aggregateIdMock2],
        });
      });

      it('paginates aggregate Ids', async () => {
        const aggregate3InitialEventTimestamp = '2023-01-01T00:00:00.000Z';
        MockDate.set(aggregate3InitialEventTimestamp);
        await storageAdapter.pushEvent(
          { version: 1, type: 'EVENT_TYPE', aggregateId: aggregateIdMock3 },
          { eventStoreId },
        );

        const aggregate4InitialEventTimestamp = '2024-01-01T00:00:00.000Z';
        MockDate.set(aggregate4InitialEventTimestamp);
        await storageAdapter.pushEvent(
          { version: 1, type: 'EVENT_TYPE', aggregateId: aggregateIdMock4 },
          { eventStoreId },
        );

        const { aggregateIds, nextPageToken } =
          await storageAdapter.listAggregateIds({ limit: 2 });

        expect(aggregateIds).toStrictEqual([
          aggregateIdMock1,
          aggregateIdMock2,
        ]);
        expect(JSON.parse(nextPageToken as string)).toStrictEqual({
          limit: 2,
          lastEvaluatedKey: aggregateIdMock2,
        });

        const lastAggregateIds = await storageAdapter.listAggregateIds({
          pageToken: nextPageToken,
        });

        expect(lastAggregateIds).toStrictEqual({
          aggregateIds: [aggregateIdMock3, aggregateIdMock4],
        });
      });

      it('applies lisAggregateIds options', async () => {
        const { aggregateIds, nextPageToken } =
          await storageAdapter.listAggregateIds({
            limit: 1,
            initialEventAfter: '2021-02-01T00:00:00.000Z',
            initialEventBefore: '2023-02-01T00:00:00.000Z',
            reverse: true,
          });

        expect(aggregateIds).toStrictEqual([aggregateIdMock3]);
        expect(JSON.parse(nextPageToken as string)).toStrictEqual({
          limit: 1,
          initialEventAfter: '2021-02-01T00:00:00.000Z',
          initialEventBefore: '2023-02-01T00:00:00.000Z',
          reverse: true,
          lastEvaluatedKey: aggregateIdMock3,
        });

        const { aggregateIds: lastAggregateIds, nextPageToken: noPageToken } =
          await storageAdapter.listAggregateIds({
            pageToken: nextPageToken,
          });

        expect(noPageToken).toBeUndefined();
        expect(lastAggregateIds).toStrictEqual([aggregateIdMock2]);
      });
    });

    describe('groupEvent', () => {
      const storageAdapter = new InMemoryStorageAdapter();

      it('groups events correctly', () => {
        const groupedEvent = storageAdapter.groupEvent(
          omit(eventMock1, 'timestamp'),
        );

        expect(groupedEvent).toBeInstanceOf(GroupedEvent);
        expect(groupedEvent).toMatchObject({
          event: omit(eventMock1, 'timestamp'),
          eventStorageAdapter: storageAdapter,
        });
      });
    });
  });

  describe('pushEventGroup', () => {
    const storageAdapterA = new InMemoryStorageAdapter();
    const storageAdapterB = new InMemoryStorageAdapter();
    // @ts-expect-error we don't care about the storage adapter, it just needs to not be an instance of InMemoryStorageAdapter
    const storageAdapterC: StorageAdapter = {};
    storageAdapterC;

    const { timestamp, ...event } = eventMock1;
    const aggregate2EventMock = {
      aggregateId: aggregateIdMock2,
      version: 1,
      type: 'EVENT_TYPE',
    };

    beforeEach(() => {
      storageAdapterA.eventStore = {};
      storageAdapterB.eventStore = {};
    });

    it('push grouped events correctly', async () => {
      const groupedEvents: [GroupedEvent, ...GroupedEvent[]] = [
        new GroupedEvent({
          event,
          eventStorageAdapter: storageAdapterA,
          context: { eventStoreId },
        }),
        new GroupedEvent({
          event: aggregate2EventMock,
          eventStorageAdapter: storageAdapterB,
          context: { eventStoreId },
        }),
      ];

      MockDate.set(timestamp);
      const eventGroup = await storageAdapterA.pushEventGroup(...groupedEvents);
      expect(eventGroup).toStrictEqual({
        eventGroup: [
          { event: eventMock1 },
          { event: { timestamp, ...aggregate2EventMock } },
        ],
      });

      const { events: eventsA } = await storageAdapterA.getEvents(
        aggregateIdMock1,
      );
      expect(eventsA).toStrictEqual([eventMock1]);

      const { events: eventsB } = await storageAdapterB.getEvents(
        aggregateIdMock2,
      );
      expect(eventsB).toStrictEqual([{ timestamp, ...aggregate2EventMock }]);
    });

    it('throws if event storage adapter is not InMemoryEventStorageAdapter', async () => {
      const groupedEvents: [GroupedEvent, ...GroupedEvent[]] = [
        new GroupedEvent({
          event,
          eventStorageAdapter: storageAdapterA,
          context: { eventStoreId },
        }),
        new GroupedEvent({
          event: aggregate2EventMock,
          eventStorageAdapter: storageAdapterC,
          context: { eventStoreId },
        }),
      ];

      MockDate.set(timestamp);
      await expect(() =>
        storageAdapterA.pushEventGroup(...groupedEvents),
      ).rejects.toThrow();
    });

    it('throws if context is missing', async () => {
      const groupedEvents: [GroupedEvent, ...GroupedEvent[]] = [
        new GroupedEvent({
          event,
          eventStorageAdapter: storageAdapterA,
          context: { eventStoreId },
        }),
        new GroupedEvent({
          event: aggregate2EventMock,
          eventStorageAdapter: storageAdapterB,
        }),
      ];

      MockDate.set(timestamp);
      await expect(() =>
        storageAdapterA.pushEventGroup(...groupedEvents),
      ).rejects.toThrow();
    });

    it('reverts all events if a push has failed', async () => {
      const pushEventSyncASpy = vi.spyOn(storageAdapterA, 'pushEventSync');
      const pushEventSyncBSpy = vi
        .spyOn(storageAdapterB, 'pushEventSync')
        .mockImplementation(() => {
          throw new Error();
        });

      const groupedEvents: [GroupedEvent, ...GroupedEvent[]] = [
        new GroupedEvent({
          event,
          eventStorageAdapter: storageAdapterA,
          context: { eventStoreId },
        }),
        new GroupedEvent({
          event: aggregate2EventMock,
          eventStorageAdapter: storageAdapterB,
          context: { eventStoreId },
        }),
      ];

      MockDate.set(timestamp);
      await expect(() =>
        storageAdapterA.pushEventGroup(...groupedEvents),
      ).rejects.toThrow();

      expect(pushEventSyncASpy).toHaveBeenCalledOnce();
      expect(pushEventSyncBSpy).toHaveBeenCalledOnce();

      const { events: eventsA } = await storageAdapterA.getEvents(
        aggregateIdMock1,
      );
      expect(eventsA).toStrictEqual([]);

      const { events: eventsB } = await storageAdapterB.getEvents(
        aggregateIdMock2,
      );
      expect(eventsB).toStrictEqual([]);
    });
  });
});
