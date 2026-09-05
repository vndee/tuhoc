import { createContext } from 'react';
import type { SceneId, StoryScene } from '../types';

interface ActiveStoryScenePrivateConfig {
  honorHash: boolean;
  onDecodeFailure: (id: StoryScene['id']) => void;
  ownerRoot: () => Element | null;
}

interface StoryShellActivationContextValue {
  onActivate: (id: SceneId) => void;
}

export const activeStoryScenePrivateContext = createContext<ActiveStoryScenePrivateConfig>({
  honorHash: true,
  onDecodeFailure: () => undefined,
  ownerRoot: () => null,
});

export const storyShellActivationContext = createContext<StoryShellActivationContextValue | null>(null);

export function findOwnedElement(root: ParentNode | null, id: string): HTMLElement | null {
  return Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []).find((element) => element.id === id) ?? null;
}
