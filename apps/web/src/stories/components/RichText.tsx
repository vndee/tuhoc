import type { RichTextBlock } from '../types';

const assertNever = (value: never): never => {
  throw new Error(`Unsupported rich-text block: ${JSON.stringify(value)}`);
};

/** Renders the deliberately closed editorial text format without an HTML sink. */
export function RichText({ blocks }: { blocks: RichTextBlock[] }) {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case 'paragraph':
        return <p key={index}>{block.text}</p>;
      case 'emphasis':
        return <p key={index} className="story-emphasis"><em>{block.text}</em></p>;
      case 'list':
        return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
      case 'termLink':
        return <p key={index}><a href={block.href}>{block.text}</a></p>;
      default:
        return assertNever(block);
    }
  });
}
