import { inspectMessage } from '../labs/communication/unicode';
import type { DeliveryReceipt } from '../labs/communication/types';
import type { SceneId } from '../types';
import type { MessageSession, SessionAction } from './types';

export function createSession(example: string): MessageSession {
  return {
    messageText: example,
    messageRevision: 0,
    draftText: example,
    shortenedDraft: example,
    experimentStateByScene: {},
    deliveryReceipt: null,
  };
}

function withoutScene(
  stateByScene: MessageSession['experimentStateByScene'],
  sceneId: SceneId,
): MessageSession['experimentStateByScene'] {
  const next = { ...stateByScene };
  delete next[sceneId];
  return next;
}

function snapshotReceipt(receipt: DeliveryReceipt): DeliveryReceipt {
  const snapshot: DeliveryReceipt = {
    ...receipt,
    source: Object.freeze([...receipt.source]),
    received: receipt.received === null ? null : Object.freeze([...receipt.received]),
    config: Object.freeze({ ...receipt.config }),
  };
  return Object.freeze(snapshot);
}

export function reduceSession(state: MessageSession, action: SessionAction): MessageSession {
  switch (action.type) {
    case 'draft':
      return { ...state, draftText: action.text };
    case 'commit': {
      if (!inspectMessage(action.text).ok || action.text === state.messageText) return state;
      return {
        ...state,
        messageText: action.text,
        messageRevision: state.messageRevision + 1,
        draftText: action.text,
      };
    }
    case 'shorten':
      return { ...state, shortenedDraft: action.text };
    case 'lab':
      return {
        ...state,
        experimentStateByScene: {
          ...state.experimentStateByScene,
          [action.sceneId]: action.value,
        },
      };
    case 'reset-lab': {
      const reset = {
        ...state,
        experimentStateByScene: withoutScene(state.experimentStateByScene, action.sceneId),
      };
      if (action.sceneId === 'scene-01') return { ...reset, shortenedDraft: '' };
      if (action.sceneId === 'scene-11') return { ...reset, deliveryReceipt: null };
      return reset;
    }
    case 'receipt':
      if (action.receipt === null) {
        return state.deliveryReceipt === null ? state : { ...state, deliveryReceipt: null };
      }
      if (action.receipt.messageRevision !== state.messageRevision) return state;
      return { ...state, deliveryReceipt: snapshotReceipt(action.receipt) };
    case 'reset-session':
      return createSession(action.example);
  }
}
