'use strict';
/* WHERE GIT LOOKS FOR A REPOSITORY IS NOT INHERITED.
 *
 * Git hands its own location to the commands it runs: GIT_DIR and its
 * siblings reach a linked worktree's hooks, and `git rebase -x`, `git bisect
 * run` and `git -c …` pass them (or GIT_CONFIG_PARAMETERS) to whatever they
 * start. Several suites build throwaway repositories in a temp directory and
 * run git there by cwd; with those variables in their environment every one
 * of those commands went to the real repository instead. Pushing from a
 * worktree once moved its branch onto sixteen fixture commits and set
 * core.bare on the whole clone. A suite finds this repository by its cwd,
 * like a person does.
 *
 * The list is git's own (`git rev-parse --local-env-vars`), so a variable a
 * later git adds is dropped too. The names below are the floor, for a machine
 * where git cannot be run, and GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n go with
 * GIT_CONFIG_COUNT.
 */
const { spawnSync } = require('child_process');

const FLOOR = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
const NUMBERED = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

let listed = null;
function repoVars() {
  if (listed) return listed;
  const env = Object.assign({}, process.env);
  for (const k of FLOOR) delete env[k];
  const r = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env, cwd: require('os').tmpdir() });
  const own = r.status === 0 ? String(r.stdout).split(/\s+/).filter(Boolean) : [];
  listed = [...new Set(FLOOR.concat(own))];
  return listed;
}

/* process.env plus extra, without anything that tells git where a repository is. */
function childEnv(extra) {
  const env = Object.assign({}, process.env, extra);
  for (const k of repoVars()) delete env[k];
  for (const k of Object.keys(env)) if (NUMBERED.test(k)) delete env[k];
  return env;
}

module.exports = { childEnv, repoVars, FLOOR };
