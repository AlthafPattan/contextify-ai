const path = require('path');
const { analyzeFile, structuralHash } = require('../src/core/analyzer');

const testFile = path.join(__dirname, 'fixtures', 'PaymentForm.tsx');

console.log('Testing AST Analyzer on PaymentForm.tsx\n');
console.log('═'.repeat(50));

const result = analyzeFile(testFile);

console.log('\nFile Type:', result.type);
console.log('Name:', result.name);
console.log('Has JSX:', result.hasJSX);
console.log('Default Export:', result.defaultExport);

console.log('\n── Exports ──');
result.exports.forEach(e => console.log(`  ${e.type}: ${e.name}`));

console.log('\n── Props ──');
result.props.forEach(p => console.log(`  ${p.name}: ${p.type} ${p.optional ? '(optional)' : ''}`));

console.log('\n── Hooks ──');
result.hooks.forEach(h => console.log(`  ${h.name}`));

console.log('\n── State ──');
result.state.forEach(s => console.log(`  ${s.getter} / ${s.setter}`));

console.log('\n── Effects ──');
console.log(`  ${result.effects.length} useEffect(s)`);

console.log('\n── Callbacks ──');
console.log(`  ${result.callbacks.length} useCallback(s)`);

console.log('\n── Dependencies (internal) ──');
result.dependencies.internal.forEach(d => console.log(`  ${d}`));

console.log('\n── Dependencies (external) ──');
result.dependencies.external.forEach(d => console.log(`  ${d}`));

console.log('\n── Type Definitions ──');
result.typeDefinitions.forEach(t => {
  console.log(`  ${t.kind} ${t.name}`);
  t.properties.forEach(p => console.log(`    ${p.name}: ${p.type} ${p.optional ? '(optional)' : ''}`));
});

console.log('\n── Functions ──');
result.functions.forEach(f => {
  console.log(`  ${f.async ? 'async ' : ''}${f.name}(${f.params.map(p => p.name).join(', ')})`);
});

console.log('\n── Structural Hash ──');
console.log(`  ${structuralHash(result)}`);

console.log('\n' + '═'.repeat(50));
console.log('✓ Analyzer test passed\n');
