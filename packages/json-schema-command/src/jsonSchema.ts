import { FromSchema, JSONSchema } from 'json-schema-to-ts';

import {
  Command,
  EventAlreadyExistsError,
  isEventAlreadyExistsError,
  EventStore,
  $Contravariant,
} from '@castore/core';

export type OnEventAlreadyExistsCallback = (
  error: EventAlreadyExistsError,
  context: { attemptNumber: number; retriesLeft: number },
) => Promise<void>;

export class JSONSchemaCommand<
  E extends EventStore[] = EventStore[],
  $E extends EventStore[] = $Contravariant<E, EventStore[]>,
  IS extends JSONSchema | undefined = JSONSchema | undefined,
  I = JSONSchema extends IS
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    : IS extends JSONSchema
    ? FromSchema<IS>
    : never,
  OS extends JSONSchema | undefined = JSONSchema | undefined,
  O = JSONSchema extends OS
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    : OS extends JSONSchema
    ? FromSchema<OS>
    : never,
> implements Command<E, $E, I, O>
{
  _types?: {
    input: I;
    output: O;
  };
  commandId: string;
  requiredEventStores: E;
  inputSchema?: IS;
  outputSchema?: OS;
  eventAlreadyExistsRetries: number;
  onEventAlreadyExists: OnEventAlreadyExistsCallback;
  handler: (input: I, requiredEventStores: $E) => Promise<O>;

  constructor({
    commandId,
    requiredEventStores,
    inputSchema,
    outputSchema,
    eventAlreadyExistsRetries = 2,
    onEventAlreadyExists = async () => new Promise(resolve => resolve()),
    handler,
  }: {
    commandId: string;
    requiredEventStores: E;
    inputSchema?: IS;
    outputSchema?: OS;
    eventAlreadyExistsRetries?: number;
    onEventAlreadyExists?: OnEventAlreadyExistsCallback;
    handler: (input: I, requiredEventStores: $E) => Promise<O>;
  }) {
    this.commandId = commandId;
    this.requiredEventStores = requiredEventStores;
    this.eventAlreadyExistsRetries = eventAlreadyExistsRetries;
    this.onEventAlreadyExists = onEventAlreadyExists;

    if (inputSchema !== undefined) {
      this.inputSchema = inputSchema;
    }

    if (outputSchema !== undefined) {
      this.outputSchema = outputSchema;
    }

    this.handler = async (input, eventStores) => {
      let retriesLeft = this.eventAlreadyExistsRetries;
      let attemptNumber = 1;

      while (retriesLeft >= 0) {
        try {
          const output = await handler(input, eventStores);

          return output;
        } catch (error) {
          if (!isEventAlreadyExistsError(error)) {
            throw error;
          }

          await this.onEventAlreadyExists(error, {
            attemptNumber,
            retriesLeft,
          });

          if (retriesLeft === 0) {
            throw error;
          }

          retriesLeft -= 1;
          attemptNumber += 1;
        }
      }

      /**
       * @debt interface "find a better thing to do in this case (which should not happen anyway)"
       */
      throw new Error('Handler failed to execute');
    };
  }
}
