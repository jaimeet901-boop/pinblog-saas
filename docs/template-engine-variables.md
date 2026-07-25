# Template Engine — Variable System (Module 5)

Provider-independent Variable Engine. Renderer and editor never hardcode tokens.

## Architecture

```text
Context (+ namespaces)
   ↓
Registry (static/dynamic/computed/conditional/ai/user)
   ↓
Expression evaluator (||, ?: , formatters, nested paths)
   ↓
Resolved strings
   ↓
Compositor / procedural renderer
```

## Registry

```js
registerVariable({
  id: 'post.title',
  type: 'dynamic', // static | dynamic | computed | conditional | ai-generated | user-defined
  namespace: 'post',
  resolve: (ctx) => ctx.post?.title ?? ctx.title,
})
```

Third parties register without modifying engine code.

## Expressions

| Feature | Example |
|---------|---------|
| Namespace path | `{{post.title}}` |
| Fallback | `{{post.subtitle \|\| post.title}}` |
| Conditional | `{{recipe.rating ? recipe.rating : "New Recipe"}}` |
| Formatter fn | `{{uppercase(post.title)}}` |
| Formatter pipe | `{{post.title \| truncate:40}}` |

Built-in formatters: `uppercase`, `lowercase`, `capitalize`, `truncate`, `date`, `number` (+ `registerFormatter`).

## AI extension

```js
registerAiVariableProvider({
  id: 'my-llm',
  match: (path) => path.startsWith('ai.'),
  resolve: (path, ctx) => ctx.aiVariables?.[path] ?? '',
})
```

Built-ins `ai.caption` / `ai.hook` read `ctx.ai.*` until a provider fills them.

## Validation

- `validateExpression(expr)`
- `validateDocumentVariables(doc)` → unknown / invalid issues

## Resolve-before-render

`renderDocument` always calls `resolveVariablesInDocument` before compose. The compositor paints only concrete values.

## Backward compatibility

Legacy `{{title}}`, `{{description}}`, … remain registered aliases. `applyTemplateVariables` delegates to the engine.
