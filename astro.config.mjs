// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://is-central.github.io',

  integrations: [
    starlight({
      title: 'IS Central',
      logo: {
        src: 'src/assets/logo.svg',
      },
      social: {
        discord: 'https://discord.gg/fqRBzQWVfK',
      },
      sidebar: [
        {
          label: 'Introduction',
          link: '/introduction/',
        },
        {
          label: 'Phantom & Crimson Solitaire (IS2)',
          items: [
            { label: 'Overview', link: '/is2-phantom/overview/' },
          ],
        },
        {
          label: 'Mizuki & Caerula Arbor (IS3)',
          items: [
            { label: 'Overview', link: '/is3-mizuki/overview/' },
          ],
        },
        {
          label: 'Expeditioner\'s Joklumarkar (IS4)',
          items: [
            { label: 'Overview', link: '/is4-expeditioners/overview/' },
          ],
        },
        {
          label: 'Sarkaz\'s Furnaceside Fables (IS5)',
          items: [
            { label: 'Overview', link: '/is5-sarkaz/overview/' },
          ],
        },
        {
          label: 'Sui\'s Garden of Grotesqueries (IS6)',
          items: [
            { label: 'Overview', link: '/is6-sui/overview/' },
          ],
        },
      ],
    }),
  ],
});