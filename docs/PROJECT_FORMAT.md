# Shapemaker project format

Shapemaker projects are portable UTF-8 JSON files with the extension
`.shapemaker.json`. They contain the inputs required to regenerate a design,
plus optional view and descriptive metadata. Generated vertex buffers and
STL/SVG exports are derived artifacts and are not stored.

No account, database, or backend is required. Projects are opened and downloaded
locally in the browser.

## Version 1 example

```json
{
  "format": "shapemaker-project",
  "formatVersion": 1,
  "name": "Prototype TPU",
  "createdWith": "0.1.0",
  "state": {
    "base": "icosidodeca",
    "circumdiameterMm": 100,
    "borderMm": 3.2,
    "depth": "hollow",
    "wallMm": 1.4,
    "openings": true,
    "filletMm": 4.5,
    "edgeDiv": 10,
    "faceIndex": 0
  },
  "view": {
    "camera": {
      "position": [120, 90, 140],
      "target": [0, 0, 40],
      "up": [0, 0, 1]
    },
    "overlay": "none"
  },
  "metadata": {
    "notes": "",
    "material": "TPU",
    "densityGPerCm3": 1.21
  },
  "extensions": {}
}
```

## Field rules

- `format` is required and must equal `"shapemaker-project"`.
- `formatVersion` is a required positive integer.
- `state` is required and uses the canonical keys from the application schema.
  It is the only section that affects compiled geometry.
- `name`, `createdWith`, `view`, `metadata`, and `extensions` are optional.
- Numeric geometry values use millimetres unless their key states otherwise.
- All saved numbers must be finite JSON numbers.
- `extensions` is an object. Third-party data belongs under namespaced keys,
  such as `"org.example.fabrication"`.
- Unknown top-level fields are preserved when safely possible but do not affect
  geometry.

## Canonical serialization

Saving a project:

1. migrates data to the latest supported format;
2. normalizes `state` through the schema;
3. writes fields in the documented canonical order;
4. omits absent optional fields rather than writing ambiguous `null` values;
5. writes two-space-indented JSON followed by a newline.

Canonical project bytes are useful for readable diffs, but geometric identity is
determined by canonical `state`, not metadata, camera position, or whitespace.

## Loading and migration

Loading follows this sequence:

1. Parse JSON and verify `format` and `formatVersion`.
2. Migrate older supported versions one version at a time.
3. Normalize canonical schema keys and apply defaults for missing optional
   state.
4. Validate through the regular `compile()` boundary.
5. Replace the current session as one undoable action.

A newer unsupported version must never be silently rewritten. The app should
show a clear compatibility message and either reject the project or open its
metadata read-only. A failed load leaves the current project unchanged.

Saving does not clear undo history. Loading begins a new named project session
and resets its dirty/unsaved baseline to the loaded canonical state.

## State, view, and metadata

### `state`

Contains every authoring input needed to regenerate geometry, including seed and
resting face. It must not contain cached metrics or generated arrays.

Exactly one representation of a physical parameter is authoritative. For
version 1, border width is stored as `borderMm`; a proportional openness value
is derived rather than stored beside it.

### `view`

Contains optional presentation state such as camera and active overlay. Removing
it must not change generated geometry or exports.

### `metadata`

Contains optional human context. Material and density may influence estimates
shown in the UI but do not change geometry unless promoted to canonical state in
a future format version.

## Related persistence

- **URL state** is compact and shareable. It contains canonical authoring state
  and orientation but normally omits project name, notes, material metadata,
  and camera state.
- **Presets** use the same canonical state shape but are immutable application
  data, not user projects.
- **Local recovery** may retain the latest unsaved session in `localStorage`.
  It is a convenience and never replaces a downloaded project file.

## Required tests

- Parse and load the version 1 example.
- Save-load-save produces identical canonical bytes.
- Loaded canonical state compiles to equivalent geometry.
- Missing optional sections receive documented defaults.
- Invalid state produces structured validation without replacing the current
  project.
- Unsupported newer versions are not overwritten.
- Every supported historical fixture migrates to the current format.
