module.exports = {
  stories: [
    "../storybook/stories/**/*.stories.mdx",
    "../storybook/stories/**/*.stories.@(js|jsx|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-ondevice-controls",
    "@storybook/addon-ondevice-actions",
    // "@storybook/addon-ondevice-backgrounds",
    "@storybook/addon-ondevice-notes",
    "@storybook/blocks"
  ],
  typescript: {
    reactDocgen: false, // FIXME: this is disabled for now due to incompatibilities with TS 5. re-enable when upgrading storybook.
  },
};
