import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob, file } from 'astro/loaders';

export const collections = {
	is2_stage_guides: defineCollection({
		loader: glob({ pattern: "!(_)*.mdx", base: "src/content/docs/is2-phantom/stages" }),
		schema: docsSchema(),
	}),
	is3_stage_guides: defineCollection({
		loader: glob({ pattern: "!(_)*.mdx", base: "src/content/docs/is3-mizuki/stages" }),
		schema: docsSchema(),
	}),
	is4_stage_guides: defineCollection({
		loader: glob({ pattern: "!(_)*.mdx", base: "src/content/docs/is4-expeditioners/stages" }),
		schema: docsSchema(),
	}),
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	is5_stage_guides: defineCollection({
		loader: glob({ pattern: "!(_)*.mdx", base: "src/content/docs/is5-sarkaz/stages" }),
		schema: docsSchema(),
	}),
};