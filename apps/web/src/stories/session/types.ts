import type { Dispatch } from 'react';
import type { DeliveryReceipt } from '../labs/communication/types';
import type { Localized, SceneId } from '../types';

export type MessageSession = {
  messageText: string;
  messageRevision: number;
  draftText: string;
  shortenedDraft: string;
  experimentStateByScene: Partial<Record<SceneId, unknown>>;
  deliveryReceipt: DeliveryReceipt | null;
};

export type SessionAction =
  | { type: 'draft'; text: string }
  | { type: 'commit'; text: string }
  | { type: 'shorten'; text: string }
  | { type: 'lab'; sceneId: SceneId; value: unknown }
  | { type: 'reset-lab'; sceneId: SceneId }
  | { type: 'receipt'; receipt: DeliveryReceipt | null }
  | { type: 'reset-session'; example: string };

export type MessageJourney = {
  state: MessageSession;
  dispatch: Dispatch<SessionAction>;
  examples: Localized;
};
