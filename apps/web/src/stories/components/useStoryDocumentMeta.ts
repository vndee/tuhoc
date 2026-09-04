import { useEffect } from 'react';
import type { Lang } from '../../i18n';

export interface StoryDocumentMetaInput {
  title: string;
  description: string;
  canonicalPath: string;
  lang: Lang;
}

interface HeadElementState {
  node: HTMLMetaElement | HTMLLinkElement;
  created: boolean;
  attributes: Map<string, string>;
}

function ownHeadElement<K extends 'meta' | 'link'>(tag: K, attribute: 'name' | 'rel', value: string): HeadElementState {
  const selector = `${tag}[${attribute}="${value}"]`;
  const existing = document.head.querySelector(selector) as (K extends 'meta' ? HTMLMetaElement : HTMLLinkElement) | null;
  const node = existing ?? document.createElement(tag);
  const attributes = new Map(Array.from(node.attributes, ({ name, value: attributeValue }) => [name, attributeValue]));
  if (!existing) {
    node.setAttribute(attribute, value);
    document.head.append(node);
  }
  return { node, created: !existing, attributes };
}

function restoreHeadElement(state: HeadElementState): void {
  if (state.created) {
    state.node.remove();
    return;
  }
  Array.from(state.node.attributes).forEach(({ name }) => state.node.removeAttribute(name));
  state.attributes.forEach((value, name) => state.node.setAttribute(name, value));
}

/** Owns only the document metadata it creates or temporarily updates for a story route. */
export function useStoryDocumentMeta({ title, description, canonicalPath, lang }: StoryDocumentMetaInput): void {
  useEffect(() => {
    const previousTitle = document.title;
    const previousLang = document.documentElement.lang;
    const descriptionNode = ownHeadElement('meta', 'name', 'description');
    const canonicalNode = ownHeadElement('link', 'rel', 'canonical');

    document.title = title;
    document.documentElement.lang = lang;
    descriptionNode.node.setAttribute('content', description);
    canonicalNode.node.setAttribute('href', new URL(canonicalPath, window.location.origin).href);

    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      restoreHeadElement(descriptionNode);
      restoreHeadElement(canonicalNode);
    };
  }, [canonicalPath, description, lang, title]);
}
