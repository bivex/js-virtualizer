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

// @virtualize
function main() {
    const app = express();
    const port = 3000;

    app.get('/', (req, res) => {
        const params = req.query
        let times = params.times
        if (!times) {
            times = 10
        }
        let word = "bottles";
        const result = []
        while (times > 0) {
            result.push(times + " " + word + " of beer on the wall")
            result.push(times + " " + word + " of beer")
            result.push("Take one down, pass it around")
            if (times === 1) {
                word = "bottle";
            }

            times = times - 1;
            if (times > 0) {
                result.push(times + " " + word + " of beer on the wall")
            } else {
                result.push("No more " + word + " of beer on the wall")
            }
        }
        res.send(result.join(', '))
    })

    app.listen(port, () => {
        console.log("Example app listening at http://localhost:" + port)
    })
}

main()
