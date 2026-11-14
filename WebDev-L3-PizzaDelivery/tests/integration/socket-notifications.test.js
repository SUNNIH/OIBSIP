import { test } from 'vitest';
import assert from 'node:assert/strict';
import { notifyOrderUpdated } from '../../server/src/realtime/socket.js';

test('order notifications target only the owning customer room', () => {
  let targetRoom;
  let emittedEvent;
  let emittedPayload;

  const mockIo = {
    to(room) {
      targetRoom = room;

      return {
        emit(event, payload) {
          emittedEvent = event;
          emittedPayload = payload;
        }
      };
    }
  };

  const order = {
    _id: 'order123',
    customerId: 'customerA'
  };

  notifyOrderUpdated(mockIo, order);

  assert.equal(targetRoom, 'customer:customerA');
  assert.equal(emittedEvent, 'order:updated');
  assert.deepEqual(emittedPayload, {
    orderId: 'order123'
  });
});

test('invalid orders cannot trigger notifications', () => {
  const mockIo = {
    to() {
      throw new Error('Notification should not be sent');
    }
  };

  assert.throws(() => {
    notifyOrderUpdated(mockIo, {
      _id: 'order123'
    });
  });
});