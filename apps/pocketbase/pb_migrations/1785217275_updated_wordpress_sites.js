/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1840834176")

  // add field
  collection.fields.addAt(32, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text3629568936",
    "max": 80,
    "min": 0,
    "name": "sync_claim_token",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(33, new Field({
    "help": "",
    "hidden": false,
    "id": "number1534827883",
    "max": null,
    "min": 0,
    "name": "sync_claim_version",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1840834176")

  // remove field
  collection.fields.removeById("text3629568936")

  // remove field
  collection.fields.removeById("number1534827883")

  return app.save(collection)
})
