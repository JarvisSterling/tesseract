/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Minimize and obfuscate production builds
  swcMinify: true,
  
  // Remove console logs in production
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  
  // Disable source maps in production (hides code)
  productionBrowserSourceMaps: false,
  
  // Webpack optimizations for code protection
  webpack: (config, { isServer, dev }) => {
    if (!dev && !isServer) {
      // Aggressive minification
      config.optimization.minimize = true;
      
      // Mangle variable names
      config.optimization.minimizer?.forEach((minimizer) => {
        if (minimizer.constructor.name === 'TerserPlugin') {
          minimizer.options.terserOptions = {
            ...minimizer.options.terserOptions,
            mangle: {
              safari10: true,
              toplevel: true,
            },
            compress: {
              drop_console: true,
              drop_debugger: true,
              pure_funcs: ['console.log', 'console.info', 'console.debug'],
            },
            output: {
              comments: false,
            },
          };
        }
      });
    }
    return config;
  },
  
  // API headers
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
