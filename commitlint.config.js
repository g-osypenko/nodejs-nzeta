// Conventional Commits (AGENTS.md §5). Checked by the commit-msg hook and by the CI `commits` job.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Long URLs and Co-Authored-By trailers are fine in the body/footer.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
