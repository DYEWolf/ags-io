import { RuleConfigSeverity, type UserConfig } from '@commitlint/types'

// Scope obligatorio: el módulo del SPEC (M0–M12) o un área transversal.
const modules = Array.from({ length: 13 }, (_, i) => `M${String(i)}`)
const areas = ['spec', 'deps', 'repo', 'ci']

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [RuleConfigSeverity.Error, 'never'],
    'scope-enum': [RuleConfigSeverity.Error, 'always', [...modules, ...areas]],
    'scope-case': [RuleConfigSeverity.Disabled],
    'subject-case': [RuleConfigSeverity.Disabled],
    'header-max-length': [RuleConfigSeverity.Error, 'always', 100],
    'body-max-line-length': [RuleConfigSeverity.Warning, 'always', 120],
  },
}

export default config
