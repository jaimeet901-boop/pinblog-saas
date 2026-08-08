/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1701416852")

  // add field
  collection.fields.addAt(18, new Field({
    "help": "",
    "hidden": false,
    "id": "date1162969253",
    "max": "",
    "min": "",
    "name": "removed_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "help": "",
    "hidden": false,
    "id": "select2354260842",
    "maxSelect": 1,
    "name": "lifecycle_state",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "active",
      "disconnected",
      "purging"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1701416852")

  // remove field
  collection.fields.removeById("date1162969253")

  // remove field
  collection.fields.removeById("select2354260842")

  return app.save(collection)
})
