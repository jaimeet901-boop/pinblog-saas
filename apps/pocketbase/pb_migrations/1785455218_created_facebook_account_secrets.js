/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation3479234172",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "owner",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_2170078043",
        "help": "",
        "hidden": false,
        "id": "relation2375286809",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "workspace",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": true,
        "collectionId": "pbc_2426737941",
        "help": "",
        "hidden": false,
        "id": "relation2100713124",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "account",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3064126824",
        "max": 4000,
        "min": 0,
        "name": "access_token",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3343851925",
        "max": 4000,
        "min": 0,
        "name": "refresh_token",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "json3314345872",
        "maxSize": 200000,
        "name": "page_tokens",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_110222606",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_facebook_account_secrets_account` ON `facebook_account_secrets` (`account`)",
      "CREATE INDEX `idx_facebook_account_secrets_workspace` ON `facebook_account_secrets` (`workspace`)",
      "CREATE INDEX `idx_facebook_account_secrets_owner` ON `facebook_account_secrets` (`owner`)"
    ],
    "listRule": null,
    "name": "facebook_account_secrets",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_110222606");

  return app.delete(collection);
})
