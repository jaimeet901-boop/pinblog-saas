/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2853033937")

  // add field
  collection.fields.addAt(41, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2776776943",
    "max": 2000,
    "min": 0,
    "name": "source_url",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(42, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1911294166",
    "max": 32,
    "min": 0,
    "name": "image_origin",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2853033937")

  // remove field
  collection.fields.removeById("text2776776943")

  // remove field
  collection.fields.removeById("text1911294166")

  return app.save(collection)
})
