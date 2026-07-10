// crash-on-start fixture：activate 即退出（监督耗尽用例）。
export default {
  activate() {
    process.exit(1);
  },
};
