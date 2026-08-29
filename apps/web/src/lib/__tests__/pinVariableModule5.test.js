import { describe, expect, it, beforeEach } from 'vitest';
import {
	applyVariablesToString,
	listRegisteredVariables,
	registerAiVariableProvider,
	registerVariable,
	resetVariableRegistryForTests,
	resolveExpression,
	resolveVariables,
	resolveVariablesInDocument,
	validateDocumentVariables,
	validateExpression,
	VARIABLE_TYPES,
} from '../pinVariableRegistry.js';
import { registerFormatter } from '../pinVariableFormatters.js';
import { applyTemplateVariables } from '../pinTemplates.js';

describe('Variable Engine Module 5', () => {
	beforeEach(() => {
		resetVariableRegistryForTests();
	});

	it('resolves legacy and namespaced tokens from registry only', () => {
		const map = resolveVariables({
			title: 'Pasta',
			post: { title: 'Pasta Night', description: 'Yum' },
			recipe: { prep_time: '10m', rating: 4.5 },
			author: { name: 'Ada' },
			brand: { logo: 'https://cdn/logo.png', primary_color: '#112233' },
		});
		expect(map['{{title}}']).toBe('Pasta');
		expect(map['{{post.title}}']).toBe('Pasta Night');
		expect(map['{{post.description}}']).toBe('Yum');
		expect(map['{{recipe.prep_time}}']).toBe('10m');
		expect(map['{{recipe.rating}}']).toBe('4.5');
		expect(map['{{author.name}}']).toBe('Ada');
		expect(map['{{brand.primary_color}}']).toBe('#112233');
		expect(listRegisteredVariables()).toContain('{{post.title}}');
		expect(listRegisteredVariables()).toContain('{{ingredients}}');
		expect(listRegisteredVariables()).toContain('{{recipe.ingredients}}');
	});

	it('resolves ingredients aliases from string or array', () => {
		const fromArray = resolveVariables({
			ingredients: ['Flour', 'Eggs', 'Milk'],
		});
		expect(fromArray['{{ingredients}}']).toBe('Flour\nEggs\nMilk');
		expect(fromArray['{{recipe.ingredients}}']).toBe('Flour\nEggs\nMilk');

		const fromString = resolveVariables({
			recipe: { ingredients: 'Butter\nSugar' },
		});
		expect(fromString['{{ingredients}}']).toBe('Butter\nSugar');
		expect(fromString['{{recipe.ingredients}}']).toBe('Butter\nSugar');

		const empty = resolveVariables({});
		expect(empty['{{ingredients}}']).toBe('');
		expect(empty['{{recipe.ingredients}}']).toBe('');
	});

	it('supports fallback expressions', () => {
		expect(resolveExpression('post.subtitle || post.title', {
			post: { title: 'Main' },
		})).toBe('Main');
		expect(applyVariablesToString('{{post.subtitle || post.title}}', {
			post: { subtitle: 'Sub', title: 'Main' },
		})).toBe('Sub');
	});

	it('supports conditional expressions', () => {
		expect(resolveExpression('recipe.rating ? recipe.rating : "New Recipe"', {
			recipe: { rating: 5 },
		})).toBe('5');
		expect(resolveExpression('recipe.rating ? recipe.rating : "New Recipe"', {
			recipe: {},
		})).toBe('New Recipe');
	});

	it('supports formatting functions and pipes', () => {
		expect(resolveExpression('uppercase(post.title)', {
			post: { title: 'hello' },
		})).toBe('HELLO');
		expect(resolveExpression('post.title | capitalize', {
			post: { title: 'hello world' },
		})).toBe('Hello world');
		expect(resolveExpression('truncate(post.title, 5)', {
			post: { title: 'abcdefgh' },
		})).toBe('abcd…');
	});

	it('allows third-party variable registration without core changes', () => {
		registerVariable({
			id: 'spice.heat',
			type: VARIABLE_TYPES.USER,
			resolve: (ctx) => ctx.spice?.heat || 'mild',
		});
		expect(applyVariablesToString('Heat: {{spice.heat}}', {
			spice: { heat: 'hot' },
		})).toBe('Heat: hot');
	});

	it('supports AI provider extension point', () => {
		registerAiVariableProvider({
			id: 'test-ai',
			resolve: (path, ctx) => ctx.aiBag?.[path] || '',
		});
		expect(resolveExpression('ai.custom_line', {
			aiBag: { 'ai.custom_line': 'Generated hook' },
		})).toBe('Generated hook');
	});

	it('validates unknown variables', () => {
		const result = validateExpression('totally.unknown.path');
		expect(result.ok).toBe(true); // warnings, not hard errors for unknown paths
		expect(result.issues.some((i) => i.reason === 'unknown_variable')).toBe(true);

		const docResult = validateDocumentVariables({
			layers: [{ props: { text: '{{missing.thing}} and {{title}}' } }],
		});
		expect(docResult.issues.some((i) => String(i.expression || i.raw).includes('missing'))).toBe(true);
	});

	it('resolves document before render consumers see values', () => {
		const doc = resolveVariablesInDocument({
			layers: [{
				props: {
					text: '{{uppercase(post.title)}} — {{recipe.rating ? recipe.rating : "New Recipe"}}',
				},
			}],
		}, {
			post: { title: 'cake' },
			recipe: {},
		});
		expect(doc.layers[0].props.text).toBe('CAKE — New Recipe');
	});

	it('keeps applyTemplateVariables backward compatible via engine', () => {
		expect(applyTemplateVariables('{{title}} by {{author}}', {
			title: 'Soup',
			author: 'Sam',
		})).toBe('Soup by Sam');
	});

	it('supports custom formatters', () => {
		registerFormatter('shout', (value) => `${String(value)}!`);
		expect(resolveExpression('shout(post.title)', { post: { title: 'Hi' } })).toBe('Hi!');
	});
});
