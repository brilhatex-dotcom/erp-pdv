import base from "@erp/config/eslint";

export default [
  ...base,
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      ".dependency-cruiser.cjs",
    ],
  },
];
