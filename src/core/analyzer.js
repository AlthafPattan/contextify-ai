const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');
const fs = require('fs');
const path = require('path');

/**
 * Parse a source file and extract structural metadata.
 * Works with JS, JSX, TS, TSX files.
 */
function analyzeFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const isTS = ext === '.ts' || ext === '.tsx';
  const isJSX = ext === '.jsx' || ext === '.tsx';

  const plugins = [
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
    'exportDefaultFrom',
    'exportNamespaceFrom',
  ];

  if (isTS) plugins.push('typescript');
  if (isJSX || isTS) plugins.push('jsx');

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });
  } catch (err) {
    return {
      filePath,
      error: `Parse error: ${err.message}`,
      type: 'unknown',
      name: path.basename(filePath, ext),
      exports: [],
      imports: [],
      props: [],
      hooks: [],
      state: [],
      dependencies: [],
    };
  }

  const analysis = {
    filePath,
    name: path.basename(filePath, ext),
    type: 'unknown', // 'component' | 'hook' | 'util' | 'context' | 'type' | 'unknown'
    exports: [],
    defaultExport: null,
    imports: [],
    props: [],
    hooks: [],
    state: [],
    effects: [],
    callbacks: [],
    memos: [],
    refs: [],
    contexts: [],
    dependencies: {
      internal: [],
      external: [],
    },
    typeDefinitions: [],
    functions: [],
    hasJSX: false,
  };

  traverse(ast, {
    // ── Track imports ──────────────────────────────
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const specifiers = nodePath.node.specifiers.map(s => {
        if (s.type === 'ImportDefaultSpecifier') return { name: s.local.name, type: 'default' };
        if (s.type === 'ImportNamespaceSpecifier') return { name: s.local.name, type: 'namespace' };
        return { name: s.imported?.name || s.local.name, type: 'named' };
      });

      const isExternal = !source.startsWith('.') && !source.startsWith('/');
      const importInfo = { source, specifiers, isExternal };

      analysis.imports.push(importInfo);

      if (isExternal) {
        analysis.dependencies.external.push(source);
      } else {
        analysis.dependencies.internal.push(source);
      }
    },

    // ── Track exports ─────────────────────────────
    ExportNamedDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      if (decl) {
        if (decl.type === 'FunctionDeclaration' && decl.id) {
          analysis.exports.push({ name: decl.id.name, type: 'function' });
        } else if (decl.type === 'VariableDeclaration') {
          decl.declarations.forEach(d => {
            if (d.id?.name) {
              analysis.exports.push({ name: d.id.name, type: 'variable' });
            }
          });
        } else if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration') {
          const name = decl.id?.name;
          if (name) {
            analysis.exports.push({ name, type: 'type' });
            analysis.typeDefinitions.push(extractTypeInfo(decl));
          }
        }
      }

      // Re-exports
      if (nodePath.node.specifiers) {
        nodePath.node.specifiers.forEach(s => {
          analysis.exports.push({
            name: s.exported?.name || s.local?.name,
            type: 'reexport',
          });
        });
      }
    },

    ExportDefaultDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      let name = 'default';
      if (decl.type === 'FunctionDeclaration' && decl.id) {
        name = decl.id.name;
      } else if (decl.type === 'Identifier') {
        name = decl.name;
      }
      analysis.defaultExport = name;
      analysis.exports.push({ name, type: 'default' });
    },

    // ── Detect JSX ────────────────────────────────
    JSXElement() {
      analysis.hasJSX = true;
    },
    JSXFragment() {
      analysis.hasJSX = true;
    },

    // ── Track React hooks ─────────────────────────
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      let hookName = null;

      if (callee.type === 'Identifier' && callee.name.startsWith('use')) {
        hookName = callee.name;
      } else if (
        callee.type === 'MemberExpression' &&
        callee.property?.name?.startsWith('use')
      ) {
        hookName = callee.property.name;
      }

      if (!hookName) return;

      const hookInfo = { name: hookName, args: [] };

      // Extract useState initial values
      if (hookName === 'useState') {
        const parent = nodePath.parentPath;
        if (parent?.node?.type === 'VariableDeclarator' && parent.node.id?.type === 'ArrayPattern') {
          const elements = parent.node.id.elements;
          hookInfo.getter = elements[0]?.name;
          hookInfo.setter = elements[1]?.name;
        }
        analysis.state.push(hookInfo);
      } else if (hookName === 'useEffect' || hookName === 'useLayoutEffect') {
        analysis.effects.push(hookInfo);
      } else if (hookName === 'useCallback') {
        analysis.callbacks.push(hookInfo);
      } else if (hookName === 'useMemo') {
        analysis.memos.push(hookInfo);
      } else if (hookName === 'useRef') {
        analysis.refs.push(hookInfo);
      } else if (hookName === 'useContext') {
        analysis.contexts.push(hookInfo);
      }

      analysis.hooks.push(hookInfo);
    },

    // ── Track function declarations ───────────────
    FunctionDeclaration(nodePath) {
      const node = nodePath.node;
      if (node.id) {
        analysis.functions.push({
          name: node.id.name,
          params: extractParams(node.params),
          returnType: extractReturnType(node),
          async: node.async,
          generator: node.generator,
        });
      }
    },

    // ── Track arrow functions assigned to variables
    VariableDeclarator(nodePath) {
      const node = nodePath.node;
      if (
        node.init &&
        (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
        node.id?.name
      ) {
        analysis.functions.push({
          name: node.id.name,
          params: extractParams(node.init.params),
          returnType: extractReturnType(node.init),
          async: node.init.async,
          generator: node.init.generator || false,
        });
      }
    },

    // ── Track TypeScript interfaces and types ─────
    TSInterfaceDeclaration(nodePath) {
      analysis.typeDefinitions.push(extractTypeInfo(nodePath.node));
    },
    TSTypeAliasDeclaration(nodePath) {
      analysis.typeDefinitions.push(extractTypeInfo(nodePath.node));
    },
  });

  // ── Detect component props from type definitions ──
  analysis.props = detectProps(analysis);

  // ── Classify file type ────────────────────────────
  analysis.type = classifyFile(analysis);

  return analysis;
}

/**
 * Extract parameter info from function params.
 */
function extractParams(params) {
  return params.map(p => {
    if (p.type === 'Identifier') {
      return {
        name: p.name,
        type: p.typeAnnotation ? serializeType(p.typeAnnotation.typeAnnotation) : 'any',
        optional: p.optional || false,
      };
    }
    if (p.type === 'ObjectPattern') {
      return {
        name: '{...}',
        type: 'object',
        properties: p.properties.map(prop => ({
          name: prop.key?.name || prop.argument?.name,
          type: prop.value?.typeAnnotation
            ? serializeType(prop.value.typeAnnotation.typeAnnotation)
            : 'any',
        })),
      };
    }
    if (p.type === 'AssignmentPattern') {
      return {
        name: p.left?.name || '?',
        type: p.left?.typeAnnotation
          ? serializeType(p.left.typeAnnotation.typeAnnotation)
          : 'any',
        defaultValue: true,
      };
    }
    return { name: '?', type: 'unknown' };
  });
}

/**
 * Extract return type annotation if present.
 */
function extractReturnType(node) {
  if (node.returnType?.typeAnnotation) {
    return serializeType(node.returnType.typeAnnotation);
  }
  return null;
}

/**
 * Serialize a TypeScript type annotation to a readable string.
 */
function serializeType(typeNode) {
  if (!typeNode) return 'any';

  switch (typeNode.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSVoidKeyword': return 'void';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSAnyKeyword': return 'any';
    case 'TSNeverKeyword': return 'never';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSArrayType':
      return `${serializeType(typeNode.elementType)}[]`;
    case 'TSUnionType':
      return typeNode.types.map(t => serializeType(t)).join(' | ');
    case 'TSIntersectionType':
      return typeNode.types.map(t => serializeType(t)).join(' & ');
    case 'TSTypeReference':
      return typeNode.typeName?.name || 'unknown';
    case 'TSLiteralType':
      if (typeNode.literal.type === 'StringLiteral') return `"${typeNode.literal.value}"`;
      return String(typeNode.literal.value);
    case 'TSFunctionType':
      return '(...) => ' + serializeType(typeNode.typeAnnotation?.typeAnnotation);
    case 'TSTypeLiteral':
      return '{ ... }';
    default:
      return 'unknown';
  }
}

/**
 * Extract type/interface info.
 */
function extractTypeInfo(node) {
  const info = {
    name: node.id?.name || 'unknown',
    kind: node.type === 'TSInterfaceDeclaration' ? 'interface' : 'type',
    properties: [],
  };

  if (node.type === 'TSInterfaceDeclaration' && node.body?.body) {
    info.properties = node.body.body
      .filter(m => m.type === 'TSPropertySignature')
      .map(m => ({
        name: m.key?.name || m.key?.value || '?',
        type: m.typeAnnotation ? serializeType(m.typeAnnotation.typeAnnotation) : 'any',
        optional: m.optional || false,
      }));
  }

  return info;
}

/**
 * Detect props from type definitions that look like component props.
 */
function detectProps(analysis) {
  // Look for interfaces/types ending in Props
  const propsType = analysis.typeDefinitions.find(t =>
    t.name.endsWith('Props') || t.name.endsWith('Properties')
  );

  if (propsType) {
    return propsType.properties;
  }

  // Look for destructured first param in the main component function
  const mainExport = analysis.defaultExport || analysis.exports[0]?.name;
  if (mainExport) {
    const fn = analysis.functions.find(f => f.name === mainExport);
    if (fn && fn.params[0]?.properties) {
      return fn.params[0].properties;
    }
  }

  return [];
}

/**
 * Classify what type of module this file is.
 */
function classifyFile(analysis) {
  const name = analysis.name;

  // Custom hook: starts with 'use' and exports a function starting with 'use'
  if (name.startsWith('use') || analysis.exports.some(e => e.name.startsWith('use'))) {
    return 'hook';
  }

  // React component: has JSX and exports a PascalCase function
  if (analysis.hasJSX) {
    return 'component';
  }

  // Context provider
  if (name.includes('Context') || name.includes('context')) {
    if (analysis.hooks.some(h => h.name === 'createContext')) {
      return 'context';
    }
  }

  // Type-only file
  if (analysis.typeDefinitions.length > 0 && analysis.functions.length === 0) {
    return 'type';
  }

  // Utility/helper
  return 'util';
}

/**
 * Generate a structural hash of a file's exports, props, and hooks.
 * Used for smart diff to detect if structural changes occurred.
 */
function structuralHash(analysis) {
  const crypto = require('crypto');
  const structural = {
    exports: analysis.exports.map(e => `${e.name}:${e.type}`).sort(),
    props: analysis.props.map(p => `${p.name}:${p.type}:${p.optional}`).sort(),
    hooks: analysis.hooks.map(h => h.name).sort(),
    state: analysis.state.map(s => `${s.getter}:${s.setter}`).sort(),
    deps: {
      internal: analysis.dependencies.internal.sort(),
      external: analysis.dependencies.external.sort(),
    },
    type: analysis.type,
    functions: analysis.functions.map(f => `${f.name}:${f.params.length}:${f.async}`).sort(),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(structural))
    .digest('hex')
    .slice(0, 16);
}

module.exports = {
  analyzeFile,
  structuralHash,
};
