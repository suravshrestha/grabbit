import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/target/**',
      '**/.wxt/**',
      '**/.output/**',
      '**/src-tauri/gen/**',
      '**/postcss.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['eslint.config.ts', 'prettier.config.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.ts', 'scripts/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      sonarjs,
      unicorn,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'react/react-in-jsx-scope': 'off',
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
          ignore: [
            '^App\\.tsx$',
            '^FormatPicker\\.tsx$',
            '^QualitySelector\\.tsx$',
            '^ProgressBar\\.tsx$',
            '^StatusMessage\\.tsx$',
            '^DownloadButton\\.tsx$',
            '^DownloadQueue\\.tsx$',
            '^QueueItem\\.tsx$',
            '^Settings\\.tsx$',
            '^useCurrentTab\\.ts$',
            '^useDownload\\.ts$',
            '^useDesktopApp\\.ts$',
            '^useQueue\\.ts$',
            '^README\\.md$',
          ],
        },
      ],
      'sonarjs/no-duplicate-string': 'warn',
    },
  },
)
