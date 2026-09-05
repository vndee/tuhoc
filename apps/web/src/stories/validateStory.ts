import type { LabKind, Localized, ResponsiveStoryImage, RichTextBlock, StoryDefinition } from './types';
import { REGISTERED_LAB_KINDS } from './labs/registry';
import { inspectMessage } from './labs/communication/unicode';

export interface StoryValidationIssue {
  code: 'missing-locale' | 'duplicate-id' | 'missing-source' | 'unknown-lab-kind' |
    'scene-count' | 'lab-count' | 'missing-image-metadata' | 'missing-provenance' |
    'missing-fallback' | 'featured-unpublished' | 'act-scene-mismatch' | 'source-count' |
    'invalid-source' | 'invalid-lab-config' | 'invalid-fallback-table' |
    'invalid-story-interaction';
  path: string;
  message: string;
}

const unique = (values: readonly string[]) => new Set(values).size === values.length;

export function validateStory(
  story: StoryDefinition,
  registeredKinds: ReadonlySet<LabKind> = REGISTERED_LAB_KINDS,
): StoryValidationIssue[] {
  const issues: StoryValidationIssue[] = [];
  const add = (code: StoryValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message });
  const text = (value: Localized, path: string) => {
    for (const lang of ['vi', 'en'] as const) {
      if (value[lang].trim() === '') add('missing-locale', `${path}.${lang}`, `${lang} text is empty`);
    }
  };
  const blocks = (value: Localized<RichTextBlock[]>, path: string) => {
    for (const lang of ['vi', 'en'] as const) {
      if (value[lang].length === 0) add('missing-locale', `${path}.${lang}`, `${lang} blocks are empty`);
      value[lang].forEach((block, index) => {
        if ('text' in block && block.text.trim() === '') add('missing-locale', `${path}.${lang}.${index}.text`, 'block text is empty');
        if (block.kind === 'list') {
          if (block.items.length === 0) add('missing-locale', `${path}.${lang}.${index}.items`, 'list items are empty');
          block.items.forEach((item, itemIndex) => {
            if (item.trim() === '') add('missing-locale', `${path}.${lang}.${index}.items.${itemIndex}`, 'list item is empty');
          });
        }
        if (block.kind === 'termLink' && block.href.trim() === '') add('missing-locale', `${path}.${lang}.${index}.href`, 'term link is empty');
      });
    }
  };
  const image = (value: ResponsiveStoryImage, path: string) => {
    if (!value.src) add('missing-image-metadata', `${path}.src`, 'image source is empty');
    if (!value.srcSet) add('missing-image-metadata', `${path}.srcSet`, 'image source set is empty');
    if (!value.sizes) add('missing-image-metadata', `${path}.sizes`, 'image sizes are empty');
    if (value.width <= 0) add('missing-image-metadata', `${path}.width`, 'image width must be positive');
    if (value.height <= 0) add('missing-image-metadata', `${path}.height`, 'image height must be positive');
    if (value.bytes <= 0) add('missing-image-metadata', `${path}.bytes`, 'image byte count must be positive');
    text(value.alt, `${path}.alt`);
    text(value.caption, `${path}.caption`);
    if (!value.provenanceId) add('missing-provenance', `${path}.provenanceId`, 'provenance id is empty');
  };
  const duplicateIds = (values: readonly string[], path: string) => {
    if (!unique(values)) {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) add('duplicate-id', `${path}.${index}.id`, 'id must be unique');
        seen.add(value);
      });
    }
  };
  const noiseDefaults = (defaultP: number, seed: number, path: string, label: string) => {
    if (!Number.isFinite(defaultP) || defaultP < 0 || defaultP > 0.5) {
      add('invalid-lab-config', `${path}.defaultP`, `${label} probability must be from 0 to 0.5`);
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      add('invalid-lab-config', `${path}.seed`, `${label} seed must be a uint32`);
    }
  };

  text(story.meta.title, 'meta.title');
  text(story.meta.deck, 'meta.deck');
  image(story.meta.cover, 'meta.cover');
  if (story.interaction) {
    if (story.interaction.kind !== 'message-journey') {
      add('invalid-story-interaction', 'interaction.kind', 'story interaction kind is unsupported');
    }
    text(story.interaction.examples, 'interaction.examples');
    for (const lang of ['vi', 'en'] as const) {
      const result = inspectMessage(story.interaction.examples[lang]);
      if (!result.ok) {
        add(
          'invalid-story-interaction',
          `interaction.examples.${lang}`,
          `message example failed validation: ${result.error}`,
        );
      }
    }
  }
  if (story.intro) blocks(story.intro, 'intro');
  if (story.courseAction) {
    if (story.courseAction.slug.trim() === '') add('missing-locale', 'courseAction.slug', 'course action slug is empty');
    text(story.courseAction.label, 'courseAction.label');
    text(story.courseAction.fallbackLabel, 'courseAction.fallbackLabel');
  }
  if (story.meta.featured && !story.meta.published) add('featured-unpublished', 'meta.featured', 'a featured story must be published');
  if (story.meta.sceneCount !== story.scenes.length) add('scene-count', 'meta.sceneCount', 'metadata does not match scenes');
  if (story.meta.labCount !== story.scenes.length) add('lab-count', 'meta.labCount', 'metadata does not match labs');

  const sceneIds = story.scenes.map((scene) => scene.id);
  const sourceIds = story.sources.map((source) => source.id);
  const actIds = story.acts.map((act) => act.id);
  const provenanceIds = story.provenance.map((record) => record.id);
  duplicateIds(sceneIds, 'scenes');
  duplicateIds(sourceIds, 'sources');
  duplicateIds(actIds, 'acts');
  duplicateIds(provenanceIds, 'provenance');

  story.acts.forEach((act, index) => {
    text(act.title, `acts.${index}.title`);
    text(act.question, `acts.${index}.question`);
    blocks(act.consequence, `acts.${index}.consequence`);
    const actual = story.scenes.filter((scene) => scene.actId === act.id).map((scene) => scene.id);
    const longest = Math.max(actual.length, act.sceneIds.length);
    for (let sceneIndex = 0; sceneIndex < longest; sceneIndex += 1) {
      if (actual[sceneIndex] !== act.sceneIds[sceneIndex]) {
        add('act-scene-mismatch', `acts.${index}.sceneIds.${sceneIndex}`, 'act scene id does not match story order');
      }
    }
  });

  story.sources.forEach((source, index) => {
    const path = `sources.${index}`;
    if (!source.title) add('invalid-source', `${path}.title`, 'source title is empty');
    if (!source.authorsOrInstitution) add('invalid-source', `${path}.authorsOrInstitution`, 'source author or institution is empty');
    if (!source.year) add('invalid-source', `${path}.year`, 'source year is empty');
    if (!URL.canParse(source.url)) add('invalid-source', `${path}.url`, 'source URL is invalid');
    if (!source.accessedAt) add('invalid-source', `${path}.accessedAt`, 'source access date is empty');
    text(source.note, `sources.${index}.note`);
  });

  story.provenance.forEach((record, index) => {
    const path = `provenance.${index}`;
    if (!record.filename) add('missing-provenance', `${path}.filename`, 'provenance filename is empty');
    if (!record.sourceOutput) add('missing-provenance', `${path}.sourceOutput`, 'provenance source output is empty');
    if (!record.createdAt) add('missing-provenance', `${path}.createdAt`, 'provenance creation date is empty');
    if (!record.tool) add('missing-provenance', `${path}.tool`, 'provenance tool is empty');
    if (!record.model) add('missing-provenance', `${path}.model`, 'provenance model is empty');
    if (!record.prompt) add('missing-provenance', `${path}.prompt`, 'provenance prompt is empty');
    if (record.edits.length === 0) add('missing-provenance', `${path}.edits`, 'provenance edits are empty');
    if (record.width <= 0) add('missing-provenance', `${path}.width`, 'provenance width must be positive');
    if (record.height <= 0) add('missing-provenance', `${path}.height`, 'provenance height must be positive');
    if (record.bytes <= 0) add('missing-provenance', `${path}.bytes`, 'provenance byte count must be positive');
    if (!record.license) add('missing-provenance', `${path}.license`, 'provenance license is empty');
    if (!record.sceneId) add('missing-provenance', `${path}.sceneId`, 'provenance scene id is empty');
  });

  story.scenes.forEach((scene, index) => {
    const path = `scenes.${index}`;
    if (!actIds.includes(scene.actId)) add('act-scene-mismatch', `${path}.actId`, 'scene act does not exist');
    text(scene.period, `${path}.period`);
    text(scene.title, `${path}.title`);
    blocks(scene.humanStory, `${path}.humanStory`);
    blocks(scene.technicalHinge, `${path}.technicalHinge`);
    text(scene.openQuestion, `${path}.openQuestion`);
    text(scene.lab.title, `${path}.lab.title`);
    text(scene.lab.instruction, `${path}.lab.instruction`);
    switch (scene.lab.kind) {
      case 'judgment-criteria':
        for (const lang of ['vi', 'en'] as const) {
          if (scene.lab.config.transcript[lang].length === 0) {
            add('missing-locale', `${path}.lab.config.transcript.${lang}`, 'transcript is empty');
          }
        }
        scene.lab.config.criteria.forEach((criterion, criterionIndex) => {
          text(criterion.label, `${path}.lab.config.criteria.${criterionIndex}.label`);
          text(criterion.finding, `${path}.lab.config.criteria.${criterionIndex}.finding`);
        });
        break;
      case 'knowledge-bottleneck':
        scene.lab.config.nodes.forEach((node, nodeIndex) => text(node.label, `${path}.lab.config.nodes.${nodeIndex}.label`));
        break;
      case 'gradient-descent':
        scene.lab.config.fundingTimeline.forEach((point, pointIndex) => text(point.label, `${path}.lab.config.fundingTimeline.${pointIndex}.label`));
        break;
      case 'attention':
        scene.lab.config.examples.forEach((example, exampleIndex) => {
          text(example.gloss, `${path}.lab.config.examples.${exampleIndex}.gloss`);
          for (const lang of ['vi', 'en'] as const) {
            if (example.tokens[lang].length === 0) {
              add('missing-locale', `${path}.lab.config.examples.${exampleIndex}.tokens.${lang}`, 'tokens are empty');
            }
          }
        });
        break;
      case 'agent-trace':
        scene.lab.config.steps.forEach((step, stepIndex) => text(step.label, `${path}.lab.config.steps.${stepIndex}.label`));
        break;
      case 'agi-definitions':
        scene.lab.config.definitions.forEach((definition, definitionIndex) => {
          text(definition.label, `${path}.lab.config.definitions.${definitionIndex}.label`);
          text(definition.note, `${path}.lab.config.definitions.${definitionIndex}.note`);
          text(definition.sourceLabel, `${path}.lab.config.definitions.${definitionIndex}.sourceLabel`);
          if (!scene.sourceIds.includes(definition.sourceId)) add('missing-source', `${path}.lab.config.definitions.${definitionIndex}.sourceId`, `definition source ${definition.sourceId} is not mapped to this scene`);
          for (const axis of ['generality', 'capability', 'autonomy'] as const) {
            if (!Number.isFinite(definition[axis]) || definition[axis] < 0 || definition[axis] > 5) {
              add('invalid-lab-config', `${path}.lab.config.definitions.${definitionIndex}.${axis}`, 'AGI definition coordinates must be finite values from 0 to 5');
            }
          }
        });
        break;
      case 'message-budget':
        if (![15, 30, 60].includes(scene.lab.config.defaultBudget)) {
          add('invalid-lab-config', `${path}.lab.config.defaultBudget`, 'message budget must be 15, 30, or 60');
        }
        break;
      case 'ambiguous-code':
        for (const symbol of ['A', 'B', 'C', 'D'] as const) {
          if (!/^[01]{1,6}$/.test(scene.lab.config.initialBook[symbol])) {
            add('invalid-lab-config', `${path}.lab.config.initialBook.${symbol}`, 'codewords must contain 1–6 binary digits');
          }
        }
        if (!/^[ABCD]{1,6}$/.test(scene.lab.config.initialSymbols)) {
          add('invalid-lab-config', `${path}.lab.config.initialSymbols`, 'initial symbols must contain 1–6 A/B/C/D symbols');
        }
        break;
      case 'morse-spacing':
        if (!['ET', 'AET', 'BEAM', 'BEAM ET'].includes(scene.lab.config.example)) {
          add('invalid-lab-config', `${path}.lab.config.example`, 'Morse example must be ET, AET, BEAM, or BEAM ET');
        }
        break;
      case 'cable-route':
        if (!Number.isInteger(scene.lab.config.defaultBudget) ||
          scene.lab.config.defaultBudget < 15 || scene.lab.config.defaultBudget > 40) {
          add('invalid-lab-config', `${path}.lab.config.defaultBudget`, 'cable route budget must be an integer from 15 to 40');
        }
        break;
      case 'pulse-channel':
        if (![1, 2, 4].includes(scene.lab.config.defaultDuration)) {
          add('invalid-lab-config', `${path}.lab.config.defaultDuration`, 'pulse duration must be 1, 2, or 4');
        }
        break;
      case 'binary-noise':
        noiseDefaults(scene.lab.config.defaultP, scene.lab.config.seed, `${path}.lab.config`, 'binary noise');
        break;
      case 'source-entropy': {
        const weights: unknown = scene.lab.config.weights;
        if (!Array.isArray(weights) || weights.length !== 4 ||
          [0, 1, 2, 3].some((index) => !Object.hasOwn(weights, index) ||
            !Number.isInteger(weights[index]) || weights[index] < 0 || weights[index] > 100) ||
          weights.every((weight) => weight === 0)) {
          add('invalid-lab-config', `${path}.lab.config.weights`, 'source weights must be four integers from 0 to 100');
        }
        if (!Number.isInteger(scene.lab.config.seed) ||
          scene.lab.config.seed < 0 || scene.lab.config.seed > 0xffff_ffff) {
          add('invalid-lab-config', `${path}.lab.config.seed`, 'source entropy seed must be a uint32');
        }
        break;
      }
      case 'huffman-message':
        if (!Number.isInteger(scene.lab.config.maxVisibleNodes) ||
          scene.lab.config.maxVisibleNodes < 1 || scene.lab.config.maxVisibleNodes > 32) {
          add(
            'invalid-lab-config',
            `${path}.lab.config.maxVisibleNodes`,
            'Huffman visible nodes must be an integer from 1 to 32',
          );
        }
        break;
      case 'repetition-channel':
        noiseDefaults(scene.lab.config.defaultP, scene.lab.config.seed, `${path}.lab.config`, 'repetition');
        break;
      case 'secded-inspector':
        if (!/^[01]{4}$/.test(scene.lab.config.data)) {
          add('invalid-lab-config', `${path}.lab.config.data`, 'SECDED data must contain exactly four binary characters');
        }
        break;
      default:
        break;
    }
    text(scene.labFallback.diagramLabel, `${path}.labFallback.diagramLabel`);
    text(scene.labFallback.explanation, `${path}.labFallback.explanation`);
    if (scene.labFallback.table) {
      for (const lang of ['vi', 'en'] as const) {
        const tablePath = `${path}.labFallback.table.${lang}`;
        const table = scene.labFallback.table[lang];
        table.headers.forEach((header, headerIndex) => {
          if (header.trim() === '') add('missing-locale', `${tablePath}.headers.${headerIndex}`, 'table header is empty');
        });
        table.rows.forEach((row, rowIndex) => {
          if (row.length !== table.headers.length) {
            add('invalid-fallback-table', `${tablePath}.rows.${rowIndex}`, 'table row width must match its headers');
          }
          row.forEach((cell, cellIndex) => {
            if (cell.trim() === '') add('missing-locale', `${tablePath}.rows.${rowIndex}.${cellIndex}`, 'table cell is empty');
          });
        });
      }
    }
    image(scene.illustration, `${path}.illustration`);
    if (!registeredKinds.has(scene.lab.kind)) add('unknown-lab-kind', `${path}.lab.kind`, `unregistered lab ${scene.lab.kind}`);
    if (!unique(scene.sourceIds)) add('duplicate-id', `${path}.sourceIds`, 'scene source ids must be unique');
    if (scene.sourceIds.length < 2 || scene.sourceIds.length > 4) add('source-count', `${path}.sourceIds`, 'a scene needs 2–4 sources');
    scene.sourceIds.forEach((id, sourceIndex) => {
      if (!sourceIds.includes(id)) add('missing-source', `${path}.sourceIds.${sourceIndex}`, `missing source ${id}`);
    });
    const sceneProvenance = story.provenance.find((record) => record.id === scene.illustration.provenanceId);
    if (!sceneProvenance || sceneProvenance.sceneId !== scene.id) {
      add('missing-provenance', `${path}.illustration.provenanceId`, 'illustration provenance does not match this scene');
    }
  });
  const coverProvenance = story.provenance.find((record) => record.id === story.meta.cover.provenanceId);
  if (!coverProvenance || coverProvenance.sceneId !== 'cover') {
    add('missing-provenance', 'meta.cover.provenanceId', 'cover provenance does not match the cover');
  }
  blocks(story.coda, 'coda');
  return issues;
}

export function assertValidStory(story: StoryDefinition, registeredKinds: ReadonlySet<LabKind> = REGISTERED_LAB_KINDS): void {
  const issues = validateStory(story, registeredKinds);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  }
}
