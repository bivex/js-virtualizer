/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-26 18:54
 * Last Updated: 2026-03-26 18:54
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const express = require('express');
const axios = require('axios');

// @virtualize
async function onGetProxy(req, res) {
    const url = req.query.url;
    if (!url) {
        res.status(400).send('Missing url parameter');
        return;
    }

    const response = await axios.get(url);
    res.send(response.data);
}

// @virtualize
function main() {
    const app = express();
    const port = 3000;

    app.get('/proxy', onGetProxy);

    app.listen(port, () => {
        console.log("Example app listening at http://localhost:" + port)
    })
}

main()
