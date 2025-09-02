import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob, file } from 'astro/loaders';

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	is5_stage_guides: defineCollection({
		loader: glob({ pattern: "!(_)*.mdx", base: "src/content/docs/is5-sarkaz/stages" }),
		schema: docsSchema(),
	}),
};