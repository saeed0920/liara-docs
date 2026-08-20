import mdx from '@next/mdx';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legacyRedirects = require('./src/data/redirects.json');

const withMDX = mdx({
  extension: /\.mdx?$/
});

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'md', 'mdx'],
  trailingSlash: true,
  transpilePackages: ['antd', 'rc-util', 'rc-pagination', 'rc-picker', 'rc-tree', 'rc-table'],

  async redirects() {
    return legacyRedirects;
  },

  async rewrites() {
    return [{ source: '/llms/:path*', destination: '/llms/:path*.md' }];
  },

  async headers() {
    return [
      {
        source: '/llms/:path*',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Content-Disposition', value: 'inline' },
          { key: 'Cache-Control', value: 'no-store' }
        ]
      },
      {
        source: '/:path*.txt',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Content-Disposition', value: 'inline' }
        ]
      },
      {
        source: '/:path*.(jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }]
      },
      {
        source: '/:path*.(css|js|otf|ttf|eot|woff|woff2)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000' }]
      }
    ];
  }
};

export default withMDX(nextConfig);
