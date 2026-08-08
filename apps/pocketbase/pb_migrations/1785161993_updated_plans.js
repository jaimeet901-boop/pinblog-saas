/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4263585338")

  // add field
  collection.fields.addAt(25, new Field({
    "help": "",
    "hidden": false,
    "id": "json4151499014",
    "maxSize": 200000,
    "name": "credit_costs",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(26, new Field({
    "help": "",
    "hidden": false,
    "id": "json2880212990",
    "maxSize": 200000,
    "name": "trial_config",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(27, new Field({
    "help": "",
    "hidden": false,
    "id": "json1944146456",
    "maxSize": 200000,
    "name": "upgrade_rules",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(28, new Field({
    "help": "",
    "hidden": false,
    "id": "json1010337675",
    "maxSize": 200000,
    "name": "downgrade_rules",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(29, new Field({
    "help": "",
    "hidden": false,
    "id": "json2146397810",
    "maxSize": 200000,
    "name": "topup_packs",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4263585338")

  // remove field
  collection.fields.removeById("json4151499014")

  // remove field
  collection.fields.removeById("json2880212990")

  // remove field
  collection.fields.removeById("json1944146456")

  // remove field
  collection.fields.removeById("json1010337675")

  // remove field
  collection.fields.removeById("json2146397810")

  return app.save(collection)
})
