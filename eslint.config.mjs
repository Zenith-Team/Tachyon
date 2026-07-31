import globals from 'globals';
import eslint from '@eslint/js';
import { globalIgnores, defineConfig } from 'eslint/config';

import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default defineConfig(
    globalIgnores([
        '**/.vscode', '**/dist', '**/*.old.*', 'eslint.config.mjs',
    ]),
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        plugins: {
            unicorn,
            local: {
                rules: {
                    'no-newline-control-body': load_noNewlineControlBody(),
                }
            }
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'warn',
        },
        languageOptions: {
            globals: globals.nodeBuiltin,
            ecmaVersion: 2025,
            sourceType: 'module',
            parserOptions: {
                warnOnUnsupportedTypeScriptVersion: false,
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            'prefer-const': 'error',
            'array-callback-return': ['error', { allowImplicit: true }],
            indent: ['error', 4, { SwitchCase: 1 }],
            semi: ['error', 'always'],
            quotes: ['warn', 'single'],
            eqeqeq: ['error', 'always', { null: 'ignore' }],

            //'local/no-newline-control-body': 'error', // temp disabled

            ...pluginRules('unicorn', {
                'escape-case': 'error',
                'number-literal-case': 'error',
                'empty-brace-spaces': 'error',
                'prefer-array-find': 'error',
                'prefer-array-flat': 'error',
                'prefer-array-flat-map': 'error',
                'prefer-array-index-of': 'error',
                'prefer-at': 'error',
                'prefer-negative-index': 'error',
                'prefer-object-from-entries': 'error',
                'prefer-prototype-methods': 'error',
                'prefer-reflect-apply': 'error',
                'prefer-includes': 'error',
                'prefer-regexp-test': 'error',
                'prefer-modern-math-apis': 'error',
                'prefer-native-coercion-functions': 'error',
                'prefer-module': 'error',
                'prefer-logical-operator-over-ternary': 'error',
                'prefer-export-from': 'error',
                'prefer-date-now': 'error',
                'prefer-default-parameters': 'error',
                'prefer-optional-catch-binding': 'warn',
                'prefer-string-starts-ends-with': 'error',
                'prefer-string-trim-start-end': 'error',
                'prefer-string-replace-all': 'error',
                'prefer-string-slice': 'error',
                'prefer-top-level-await': 'error',
                'custom-error-definition': 'error',
                'error-message': 'error',
                'no-array-method-this-argument': 'error',
                'no-object-as-default-parameter': 'error',
                'no-useless-spread': 'error',
                'no-useless-fallback-in-spread': 'error',
                'no-useless-promise-resolve-reject': 'error',
                'no-useless-undefined': 'error',
                'throw-new-error': 'error',
                'prefer-node-protocol': 'error',
            }),

            ...pluginRules('@typescript-eslint', {
                'prefer-string-starts-ends-with': ['error', { allowSingleElementEquality: 'always' }],
                'array-type': 'off',
                'no-deprecated': 'error',
                'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
                'no-unnecessary-condition': ['error', { allowConstantLoopConditions: 'only-allowed-literals' }],
                'use-unknown-in-catch-callback-variable': 'off',
                'no-confusing-void-expression': 'off',
                'prefer-nullish-coalescing': ['error', { ignorePrimitives: true }],
                'no-unnecessary-type-parameters': 'off',
                'no-extraneous-class': ['error', {
                    allowConstructorOnly: true,
                    allowEmpty: true,
                }],
                'no-invalid-void-type': 'off',
                'require-await': 'off',
                'unbound-method': 'off',
                'no-namespace': ['off', {
                    allowDeclarations: true,
                }],
                'no-non-null-assertion': 'off',
                'no-inferrable-types': ['warn', {
                    ignoreParameters: true,
                    ignoreProperties: true,
                }],
                'no-unused-vars': ['off', {
                    vars: 'all',
                    args: 'none',
                    ignoreRestSiblings: false,
                }],
                'no-misused-promises': ['error', {
                    checksVoidReturn: false,
                }],
                'ban-ts-comment': ['warn', {
                    minimumDescriptionLength: 3,
                    'ts-check': false,
                    'ts-expect-error': 'allow-with-description',
                    'ts-ignore': true,
                    'ts-nocheck': true,
                }],
                'restrict-template-expressions': ['error', {
                    allowNumber: true,
                    allowBoolean: true,
                    allowAny: false,
                    allowNullish: false,
                    allowRegExp: true,
                    allow: [
                        {
                            from: 'package', package: 'rpxlib', name: [
                                'uint8', 'uint16', 'uint32', 'sint8', 'sint16', 'sint32'
                            ]
                        }
                    ],
                }],
                // temporarily off
                'prefer-literal-enum-member': ['off', { allowBitwiseExpressions: true }],
                // temporary rules
                'prefer-for-of': 'off',
                'consistent-type-assertions': 'off',
                'no-unnecessary-type-conversion': 'off',
                'no-unsafe-enum-comparison': 'off',
                'prefer-return-this-type': 'off',
                'adjacent-overload-signatures': 'off',
                'consistent-indexed-object-style': 'off',
                'consistent-type-imports': ['error', {
                    disallowTypeAnnotations: true,
                    fixStyle: 'inline-type-imports',
                    prefer: 'type-imports',
                }],
            }),
        },
    },
    {
        files: ['**/*.js'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ['**/test/**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unused-vars': ['off', {
                varsIgnorePattern: '^_',
                argsIgnorePattern: '^_',
            }],
        },
    },
);

/**
 * @param {string} pluginNamespace
 * @param {import('eslint').Linter.RulesRecord} rulesObj */
function pluginRules(pluginNamespace, rulesObj = {}) {
    if (!pluginNamespace) throw new Error("ESLint config: pluginRules() called with no namespace.");

    return Object.fromEntries(
        Object.entries(rulesObj).map(
            ([rule, v]) => [`${pluginNamespace}/${rule}`, v]
        )
    );
}

//*-----------------
//* CUSTOM RULES
//*-----------------

function load_noNewlineControlBody() {
  /** @type {import('eslint').Rule.RuleModule} */
  const noNewlineControlBody = {
    meta: {
      type: 'layout',
      docs: {
        description: 'Disallow newline between control statement headers (`if`, `for`, `while`) and single-statement bodies when braces are omitted, also enforces multi-line header alignment.',
        recommended: false,
      },
      messages: {
        newline: "Unbraced '{{type}}' body must be on the same line as the closing ')'.",
        parenAlignment: "Multi-line '{{type}}' header cannot start on the same line as '('.",
        newlineElse: "Unbraced 'else' body must be on the same line as 'else'.",
      },
      schema: [],
    },
    /**
     * @param {import('eslint').Rule.RuleContext} context
     * @returns {import('eslint').Rule.RuleListener}
     */
    create(context) {
      const sourceCode = context.sourceCode;

      /** @param {number} start @param {number} end */
      function hasNewlineBetween(start, end) {
        const text = sourceCode.text.slice(start, end);
        return /\r?\n/.test(text);
      }

      /**
       * @param {import('estree').Node & { body?: any; test?: any; type: string; consequent?: any; alternate?: any }} node
       * @param {'if' | 'for' | 'while'} type
       */
      function checkControlBody(node, type) {
        // --- determine the node containing the body ---
        const bodyNode = type === 'if' ? node.consequent : node.body;
        if (!bodyNode) return;

        // --- find opening and closing parentheses ---
        const keywordToken = sourceCode.getFirstToken(node, t => t.value === type);
        if (!keywordToken) return;

        const openParenToken = sourceCode.getTokenAfter(keywordToken, t => t.value === '(');
        if (!openParenToken) return;

        const lastTestToken = node.test ? sourceCode.getLastToken(node.test) : openParenToken;
        const closingParenToken = lastTestToken ? sourceCode.getTokenAfter(lastTestToken, t => t.value === ')') : null;
        if (!closingParenToken || !bodyNode.range) return;

        const bodyStart = bodyNode.range[0];

        // --- forbid newline between closing paren and body ---
        if (hasNewlineBetween(closingParenToken.range[1], bodyStart)) {
          context.report({ node: bodyNode, messageId: 'newline', data: { type } });
        }

        // --- forbid multi-line header starting on same line as '(' ---
        const firstTokenAfterOpenParen = sourceCode.getTokenAfter(openParenToken);
        if (firstTokenAfterOpenParen) {
          const conditionIsOnSameLineAsOpen = firstTokenAfterOpenParen.loc.start.line === openParenToken.loc.start.line;
          if (openParenToken.loc.start.line !== closingParenToken.loc.end.line && conditionIsOnSameLineAsOpen) {
            context.report({ node: openParenToken, messageId: 'parenAlignment', data: { type } });
          }
        }

        // --- handle else bodies for `if` ---
        if (type === 'if' && node.alternate) {
          const elseToken = sourceCode.getTokenBefore(node.alternate, t => t.value === 'else');
          if (elseToken && node.alternate.type !== 'BlockStatement' && node.alternate.range) {
            if (hasNewlineBetween(elseToken.range[1], node.alternate.range[0])) {
              context.report({ node: node.alternate, messageId: 'newlineElse' });
            }
            // No recursion; the alternate `IfStatement` (else if) will be processed by the main visitor automatically
          }
        }
      }

      return {
        IfStatement(node) { checkControlBody(node, 'if'); },
        ForStatement(node) { checkControlBody(node, 'for'); },
        ForOfStatement(node) { checkControlBody(node, 'for'); },
        ForInStatement(node) { checkControlBody(node, 'for'); },
        WhileStatement(node) { checkControlBody(node, 'while'); },
      };
    },
  };
  return noNewlineControlBody;
}
