/**
 * Compute the result of evaluating 'expression', and compare it to 'result'. Replaces the contents
 * of 'coll' with a single empty document.
 */
function testExpression(coll, expression, result) {
    testExpressionWithCollation(coll, expression, result);
}

/**
 * Compute the result of evaluating 'expression', and compare it to 'result', using 'collationSpec'
 * as the collation spec. Replaces the contents of 'coll' with a single empty document.
 */
function testExpressionWithCollation(coll, expression, result, collationSpec) {
    assert.commandWorked(coll.remove({}));
    assert.commandWorked(coll.insert({}));

    const options = collationSpec !== undefined ? {collation: collationSpec} : undefined;

    const res = coll.aggregate([{$project: {output: expression}}], options).toArray();

    assert.eq(res.length, 1, tojson(res));
    assert.eq(res[0].output, result, tojson(res));
}

/**
 * Returns true if 'al' is the same as 'ar'. If the two are arrays, the arrays can be in any order.
 * Objects (either 'al' and 'ar' themselves, or embedded objects) must have all the same properties,
 * with the exception of '_id'. If 'al' and 'ar' are neither object nor arrays, they must compare
 * equal using 'valueComparator', or == if not provided.
 */
function anyEq(al, ar, verbose = false, valueComparator) {
    const debug = msg => verbose ? print(msg) : null;  // Helper to log 'msg' iff 'verbose' is true.

    if (al instanceof Array) {
        if (!(ar instanceof Array)) {
            debug('anyEq: ar is not an array ' + tojson(ar));
            return false;
        }

        if (!arrayEq(al, ar, verbose, valueComparator)) {
            debug(`anyEq: arrayEq(al, ar): false; al=${tojson(al)}, ar=${tojson(ar)}`);
            return false;
        }
    } else if (al instanceof Object) {
        // Be sure to explicitly check for Arrays, since Arrays are considered instances of Objects,
        // and we do not want to consider [] to be equal to {}.
        if (!(ar instanceof Object) || (ar instanceof Array)) {
            debug('anyEq: ar is not an object ' + tojson(ar));
            return false;
        }

        if (!documentEq(al, ar, verbose, valueComparator)) {
            debug(`anyEq: documentEq(al, ar): false; al=${tojson(al)}, ar=${tojson(ar)}`);
            return false;
        }
    } else if ((valueComparator && !valueComparator(al, ar)) || (!valueComparator && al !== ar)) {
        // Neither an object nor an array, use the custom comparator if provided.
        debug(`anyEq: (al != ar): false; al=${tojson(al)}, ar=${tojson(ar)}`);
        return false;
    }

    debug(`anyEq: these are equal: ${tojson(al)} == ${tojson(ar)}`);
    return true;
}

/**
 * Compares two documents for equality using a custom comparator for the values which returns true
 * or false. Returns true or false. Only equal if they have the exact same set of properties, and
 * all the properties' values match according to 'valueComparator'.
 */
function customDocumentEq({left, right, verbose, valueComparator}) {
    return documentEq(left, right, verbose, valueComparator);
}

/**
 * Compare two documents for equality. Returns true or false. Only equal if they have the exact same
 * set of properties, and all the properties' values match.
 */
function documentEq(dl, dr, verbose = false, valueComparator) {
    const debug = msg => verbose ? print(msg) : null;  // Helper to log 'msg' iff 'verbose' is true.

    // Make sure these are both objects.
    if (!(dl instanceof Object)) {
        debug('documentEq:  dl is not an object ' + tojson(dl));
        return false;
    }
    if (!(dr instanceof Object)) {
        debug('documentEq:  dr is not an object ' + tojson(dr));
        return false;
    }

    // Start by checking for all of dl's properties in dr.
    for (let propertyName in dl) {
        // Skip inherited properties.
        if (!dl.hasOwnProperty(propertyName))
            continue;

        // The documents aren't equal if they don't both have the property.
        if (!dr.hasOwnProperty(propertyName)) {
            debug('documentEq: dr doesn\'t have property ' + propertyName);
            return false;
        }

        // If the property is the _id, they don't have to be equal.
        if (propertyName == '_id')
            continue;

        if (!anyEq(dl[propertyName], dr[propertyName], verbose, valueComparator)) {
            return false;
        }
    }

    // Now make sure that dr doesn't have any extras that dl doesn't have.
    for (let propertyName in dr) {
        if (!dr.hasOwnProperty(propertyName))
            continue;

        // If dl doesn't have this they are not equal; if it does, we compared it above and know it
        // to be equal.
        if (!dl.hasOwnProperty(propertyName)) {
            debug('documentEq: dl is missing property ' + propertyName);
            return false;
        }
    }

    debug(`documentEq: these are equal: ${tojson(dl)} == ${tojson(dr)}`);
    return true;
}

function arrayEq(al, ar, verbose = false, valueComparator) {
    const debug = msg => verbose ? print(msg) : null;  // Helper to log 'msg' iff 'verbose' is true.

    // Check that these are both arrays.
    if (!(al instanceof Array)) {
        debug('arrayEq: al is not an array: ' + tojson(al));
        return false;
    }

    if (!(ar instanceof Array)) {
        debug('arrayEq: ar is not an array: ' + tojson(ar));
        return false;
    }

    if (al.length != ar.length) {
        debug(`arrayEq:  array lengths do not match ${tojson(al)}, ${tojson(ar)}`);
        return false;
    }

    // Keep a set of which indexes we've already used to avoid considering [1,1] as equal to [1,2].
    const matchedElementsInRight = new Set();
    for (let leftElem of al) {
        let foundMatch = false;
        for (let i = 0; i < ar.length; ++i) {
            if (!matchedElementsInRight.has(i) &&
                anyEq(leftElem, ar[i], verbose, valueComparator)) {
                matchedElementsInRight.add(i);  // Don't use the same value each time.
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            return false;
        }
    }

    return true;
}

/**
 * Makes a shallow copy of 'a'.
 */
function arrayShallowCopy(a) {
    assert(a instanceof Array, 'arrayShallowCopy: argument is not an array');
    return a.slice();  // Makes a copy.
}

/**
 * Compare two sets of documents (expressed as arrays) to see if they match. The two sets must have
 * the same documents, although the order need not match and the _id values need not match.
 *
 * Are non-scalar values references?
*/
function resultsEq(rl, rr, verbose = false) {
    const debug = msg => verbose ? print(msg) : null;  // Helper to log 'msg' iff 'verbose' is true.

    // Make clones of the arguments so that we don't damage them.
    rl = arrayShallowCopy(rl);
    rr = arrayShallowCopy(rr);

    if (rl.length != rr.length) {
        debug(`resultsEq:  array lengths do not match ${tojson(rl)}, ${tojson(rr)}`);
        return false;
    }

    for (let i = 0; i < rl.length; ++i) {
        let foundIt = false;

        // Find a match in the other array.
        for (let j = 0; j < rr.length; ++j) {
            if (!anyEq(rl[i], rr[j], verbose))
                continue;

            // Because we made the copies above, we can edit these out of the arrays so we don't
            // check on them anymore.
            // For the inner loop, we're going to be skipping out, so we don't need to be too
            // careful.
            rr.splice(j, 1);
            foundIt = true;
            break;
        }

        if (!foundIt) {
            // If we got here, we didn't find this item.
            debug(`resultsEq: search target missing index ${i} (${tojson(rl[i])})`);
            return false;
        }
    }

    assert(!rr.length);
    return true;
}

function orderedArrayEq(al, ar, verbose = false) {
    if (al.length != ar.length) {
        if (verbose)
            print(`orderedArrayEq:  array lengths do not match ${tojson(al)}, ${tojson(ar)}`);
        return false;
    }

    for (let i = 0; i < al.length; ++i) {
        if (!anyEq(al[i], ar[i], verbose))
            return false;
    }

    return true;
}

/**
 * Asserts that the given aggregation fails with a specific code. Error message is optional.
 */
function assertErrorCode(coll, pipe, code, errmsg) {
    if (!Array.isArray(pipe)) {
        pipe = [pipe];
    }

    let cmd = {pipeline: pipe};
    cmd.cursor = {batchSize: 0};

    let cursorRes = coll.runCommand("aggregate", cmd);
    if (cursorRes.ok) {
        let followupBatchSize = 0;  // default
        let cursor = new DBCommandCursor(coll.getDB(), cursorRes, followupBatchSize);

        let error = assert.throws(function() {
            cursor.itcount();
        }, [], "expected error: " + code);

        assert.eq(error.code, code, tojson(error));
    } else {
        assert.eq(cursorRes.code, code, tojson(cursorRes));
    }
}

/**
 * Assert that an aggregation fails with a specific code and the error message contains the given
 * string.
 */
function assertErrMsgContains(coll, pipe, code, expectedMessage) {
    const response = assert.commandFailedWithCode(
        coll.getDB().runCommand({aggregate: coll.getName(), pipeline: pipe, cursor: {}}), code);
    assert.neq(
        -1,
        response.errmsg.indexOf(expectedMessage),
        "Error message did not contain '" + expectedMessage + "', found:\n" + tojson(response));
}
