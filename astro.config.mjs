// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://is-central.github.io',
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
  integrations: [
    starlight({
      title: 'IS Central',
      logo: {
        src: '/src/assets/logo.svg',
      },
      social: [
		{
			icon: 'discord',
			label: 'Discord',
			href: 'https://discord.gg/fqRBzQWVfK',
		},
	  ],
	  customCss: ['/src/styles/custom.css'],
      pagination: false,
      sidebar: [
        {
          label: 'Introduction',
          link: '/introduction/',
        },
        {
          label: 'Contribute',
          link: '/contribute/',
        },
        {
          label: 'Getting Started',
          link: '/getting-started/',
        },
        {
          label: 'Phantom & Crimson Solitaire (IS2)',
          link: '/is2-phantom/overview/',
        },
        {
          label: 'Mizuki & Caerula Arbor (IS3)',
          link: '/is3-mizuki/overview/',
        },
        {
          label: 'Expeditioner\'s Joklumarkar (IS4)',
          link: '/is4-expeditioners/overview/',
        },
        {
          label: 'Sarkaz\'s Furnaceside Fables (IS5)',
          link: '/is5-sarkaz/overview/',
        },
        {
          label: 'Sui\'s Garden of Grotesqueries (IS6)',
          link: '/is6-sui/overview/',
        },
      ],
    }),
  ],
});