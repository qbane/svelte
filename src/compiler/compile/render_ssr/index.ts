import { b, Expression } from 'code-red';
import Component from '../Component';
import { CompileOptions, CssResult } from '../../interfaces';
import Renderer from './Renderer';
import { INode as TemplateNode } from '../nodes/interfaces'; // TODO
import Text from '../nodes/Text';
import { LabeledStatement, Statement, Node } from 'estree';
import { extract_names } from 'periscopic';
import { walk } from 'estree-walker';

import { invalidate } from '../render_dom/invalidate';
import check_enable_sourcemap from '../utils/check_enable_sourcemap';

export interface SSROutput {
	svelte_version: string
	component_name: string
	dev: boolean

	// blocks
	injected_reactive_declaration_vars: string[]
	rest_export_names: string[]
	uses_slots: boolean,
	reactive_store_declarations: Array<{ name: string; reassigned: boolean }>
	reactive_store_subscriptions: string[]
	instance_javascript: Node[]
	parent_bindings: Array<{ name: string; export_name: string }>
	main: {
		has_bindings: boolean
		reactive_declarations: Node[][]
		reactive_store_unsubscriptions: string[]
	}

	// js codegen
	css_sourcemap_enabled: boolean
	css: CssResult
	module_javascript: Node[]
	fully_hoisted_statements: Array<(Node | Node[])>
	literal: Expression
}

export default function ssr(
	component: Component,
	options: CompileOptions
): SSROutput {
	const renderer = new (options.__renderer || Renderer)({
		name: component.name
	});

	const { name } = component;

	// create $$render function
	renderer.render(trim(component.fragment.children), Object.assign({
		locate: component.locate
	}, options));

	// TODO put this inside the Renderer class
	const literal = renderer.pop();

	// TODO concatenate CSS maps
	const css = options.customElement ?
		{ code: null, map: null } :
		component.stylesheet.render(options.filename, true);

	const uses_rest = component.var_lookup.has('$$restProps');
	const props = component.vars.filter(variable => !variable.module && variable.export_name);
	const rest_export_names = uses_rest ? props.map(prop => prop.export_name) : [];

	const uses_slots = component.var_lookup.has('$$slots');

	const reactive_stores = component.vars.filter(variable => variable.name[0] === '$' && variable.name[1] !== '$');
	const reactive_store_subscriptions = reactive_stores
		.filter(store => {
			const variable = component.var_lookup.get(store.name.slice(1));
			return !variable || variable.hoistable;
		})
		.map(({ name }) => name);
	const reactive_store_unsubscriptions = reactive_stores.map(
		({ name }) => name.slice(1)
	);

	const reactive_store_declarations = reactive_stores
		.map(({ name }) => {
			const store_name = name.slice(1);
			const store = component.var_lookup.get(store_name);
			const reassigned = store && store.reassigned;
			return { name, reassigned };
		});

	// instrument get/set store value
	if (component.ast.instance) {
		let scope = component.instance_scope;
		const map = component.instance_scope_map;

		walk(component.ast.instance.content, {
			enter(node: Node) {
				if (map.has(node)) {
					scope = map.get(node);
				}
			},
			leave(node: Node) {
				if (map.has(node)) {
					scope = scope.parent;
				}

				if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
					const assignee = node.type === 'AssignmentExpression' ? node.left : node.argument;
					const names = new Set(extract_names(assignee as Node));
					const to_invalidate = new Set<string>();

					for (const name of names) {
						const variable = component.var_lookup.get(name);
						if (variable &&
							!variable.hoistable &&
							!variable.global &&
							!variable.module &&
							(
								variable.subscribable || variable.name[0] === '$'
							)) {
								to_invalidate.add(variable.name);
							}
					}

					if (to_invalidate.size) {
						this.replace(
							invalidate(
								{ component } as any,
								scope,
								node,
								to_invalidate,
								true
							)
						);
					}
				}
			}
		});
	}

	component.rewrite_props(({ name, reassigned }) => {
		const value = `$${name}`;

		let insert = reassigned
			? b`${`$$subscribe_${name}`}()`
			: b`${`$$unsubscribe_${name}`} = @subscribe(${name}, #value => $${value} = #value)`;

		if (component.compile_options.dev) {
			insert = b`@validate_store(${name}, '${name}'); ${insert}`;
		}

		return insert;
	});

	const instance_javascript = component.extract_javascript(component.ast.instance);

	// TODO only do this for props with a default value
	const parent_bindings = instance_javascript
		? component.vars
			.filter(variable => !variable.module && variable.export_name)
			.map(({name, export_name}) => ({name, export_name}))
		: [];

	const injected_reactive_declaration_vars = Array.from(component.injected_reactive_declaration_vars).filter(name => {
		const variable = component.var_lookup.get(name);
		return variable.injected;
	});

	const reactive_declarations = component.reactive_declarations.map(d => {
		const body: Statement = (d.node as LabeledStatement).body;

		let statement = b`${body}`;

		if (!d.declaration) { // TODO do not add label if it's not referenced
			statement = b`$: { ${statement} }`;
		}

		return statement;
	});


	const css_sourcemap_enabled = check_enable_sourcemap(options.enableSourcemap, 'css');
	const module_javascript = component.extract_javascript(component.ast.module);
	const fully_hoisted_statements = component.fully_hoisted;

	return {
		svelte_version: '__VERSION__',
		component_name: name.name,
		dev: component.compile_options.dev,

		injected_reactive_declaration_vars,
		rest_export_names,
		uses_slots,
		reactive_store_declarations,
		reactive_store_subscriptions,
		instance_javascript,
		parent_bindings,
		main: {
			has_bindings: renderer.has_bindings,
			reactive_declarations,
			reactive_store_unsubscriptions
		},

		css_sourcemap_enabled,
		css,
		module_javascript,
		fully_hoisted_statements,
		literal
	};
}

function trim(nodes: TemplateNode[]) {
	let start = 0;
	for (; start < nodes.length; start += 1) {
		const node = nodes[start] as Text;
		if (node.type !== 'Text') break;

		node.data = node.data.replace(/^\s+/, '');
		if (node.data) break;
	}

	let end = nodes.length;
	for (; end > start; end -= 1) {
		const node = nodes[end - 1] as Text;
		if (node.type !== 'Text') break;

		node.data = node.data.trimRight();
		if (node.data) break;
	}

	return nodes.slice(start, end);
}
