/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4084405667")

  // add field
  collection.fields.addAt(34, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "help": "",
    "hidden": false,
    "id": "relation3725765462",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "created_by",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(35, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "help": "",
    "hidden": false,
    "id": "relation3245004474",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "last_edited_by",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4084405667")

  // remove field
  collection.fields.removeById("relation3725765462")

  // remove field
  collection.fields.removeById("relation3245004474")

  return app.save(collection)
})
