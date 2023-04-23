import { b, x } from 'code-red';
import { Node } from 'estree';
import type { SSROutput } from './index';
import { string_literal } from '../utils/stringify';
import { CssResult } from '../../interfaces';

export function generate_from_ssr_metadata(metadata: SSROutput): {js: Node[], css: CssResult} {
    const {
        component_name,
        dev,
        injected_reactive_declaration_vars,
        rest_export_names,
        uses_slots,
        reactive_store_declarations,
        reactive_store_subscriptions,
        instance_javascript,
        parent_bindings,
        main: {
            has_bindings,
            reactive_declarations,
            reactive_store_unsubscriptions
        },
        css_sourcemap_enabled,
        css,
        module_javascript,
        fully_hoisted_statements,
        literal
    } = metadata;

    const name = x`${component_name}`;

    const reactive_declarations_code = reactive_declarations;
    const reactive_store_unsubscriptions_code = reactive_store_unsubscriptions.map(store_name => b`${`$$unsubscribe_${store_name}`}()`);

    const main = has_bindings
        ? b`
            let $$settled;
            let $$rendered;

            do {
                $$settled = true;

                ${reactive_declarations_code}

                $$rendered = ${literal};
            } while (!$$settled);

            ${reactive_store_unsubscriptions_code}

            return $$rendered;
        `
        : b`
            ${reactive_declarations_code}

            ${reactive_store_unsubscriptions_code}

            return ${literal};
        `;

    const blocks = [
        ...injected_reactive_declaration_vars.map(name => b`let ${name};`),
        rest_export_names.length ? b`let $$restProps = @compute_rest_props($$props, [${rest_export_names.map(export_name => `"${export_name}"`).join(',')}]);` : null,
        uses_slots ? b`let $$slots = @compute_slots(#slots);` : null,
        ...reactive_store_declarations.map(({name, reassigned}) => {
            const store_name = name.slice(1);
            if (reassigned) {
                const unsubscribe = `$$unsubscribe_${store_name}`;
                const subscribe = `$$subscribe_${store_name}`;

                return b`let ${name}, ${unsubscribe} = @noop, ${subscribe} = () => (${unsubscribe}(), ${unsubscribe} = @subscribe(${store_name}, $$value => ${name} = $$value), ${store_name})`;
            }
            return b`let ${name}, ${`$$unsubscribe_${store_name}`};`;
        }),
        ...reactive_store_subscriptions.map(name => {
            const store_name = name.slice(1);
            return b`
                ${dev && b`@validate_store(${store_name}, '${store_name}');`}
                ${`$$unsubscribe_${store_name}`} = @subscribe(${store_name}, #value => ${name} = #value)
            `;
        }),
        instance_javascript,
        ...parent_bindings.map(prop => {
            return b`if ($$props.${prop.export_name} === void 0 && $$bindings.${prop.export_name} && ${prop.name} !== void 0) $$bindings.${prop.export_name}(${prop.name});`;
        }),
        css.code && b`$$result.css.add(#css);`,
        main
    ].filter(Boolean);

    const js = b`
        ${css.code ? b`
        const #css = {
            code: "${css.code}",
            map: ${css_sourcemap_enabled && css.map ? string_literal(css.map.toString()) : 'null'}
        };` : null}

        ${module_javascript}

        ${fully_hoisted_statements}

        const ${name} = @create_ssr_component(($$result, $$props, $$bindings, #slots) => {
            ${blocks}
        });
    `;

    return {js, css};
}
