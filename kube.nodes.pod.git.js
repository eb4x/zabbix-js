function parseFilters(filter) {
    var filters = [];

    /* This regex can be broken down into to this;
     *
     * [\w\.-]+ will create a character class `[]` to capture `a-zA-Z0-9_-.`
     *
     * We then create a capture group `()` looking for two of these separated
     * by a `/` and ending in a `:` e.g. `word0/word1:`
     *
     * lastly, we're catching whatever comes after whitespace
     * \s*.+
     */
    const isValidFilterExpression = /([\w\.-]+\/[\w\.-]+):\s*.+/;

    filter.split(/\s*,\s*/).forEach(function (kv) {
        if (!isValidFilterExpression.test(kv)) {
            Zabbix.log(3, 'Cannot parse filter from: "' + kv + '"');
            return;
        }

        var pair = kv.split(/\s*:\s*/);
        filters.push({ key: pair[0], expression: pair[1] });
    });

    return filters;
}

function filter(name, data, filters) {
    if (typeof data !== 'object') {
        return true;
    }

    /*
     * We're using the .every( method for iterating over all filters to make sure
     * data contains values we deem worthy of inclusion.
     * If there's any filter that wants to exclude an element based on contents
     * in data, we don't need to process additional filters, we can just stop
     * (by returing false) to exclude the element.
     *
     * .every( also has the benefit that if filters is an empty array, it returns
     * true, which allows us to use its return value.
     */
    return filters.every(function (filter) {

        const filter_key = filter.key.startsWith('!') ? filter.key.substring(1) : filter.key;
        if (!(filter_key in data)) {
            // if we have nothing to compare to, we're accepting the element
            // which might not be a good idea?
            return true;
        }

        const isExcludingFilter = filter.key.startsWith('!');
        const isMatchForFilter = new RegExp(filter.expression).test(data[filter_key]);
        if ((isExcludingFilter && isMatchForFilter) ||
            (!isExcludingFilter && !isMatchForFilter)) {
            Zabbix.log(4, '[ Kubernetes discovery ] Discarded "' + name + '" by filter "' + filter.key + ': ' + filter.expression + '"');

            return false;
        }

        // we've passed this filter, let's try the rest
        return true;
    });
}

try {
    var input = JSON.parse(value);
    if (typeof input !== 'object' || typeof input.nodes === 'undefined') {
        Zabbix.log(4, '[ Kubernetes ] Received incorrect JSON: ' + value);
        throw new Error('Incorrect JSON. Check debug log for more information.');
    }

    var filterNodeLabels = parseFilters('!kubernetes.io/hostname: \\w+-[1-2],  node-role.kubernetes.io/master: .*, dope'),
        filterNodeAnnotations = parseFilters('{$KUBE.NODE.FILTER.ANNOTATIONS}'),
        filterPodLabels = parseFilters(''),
        filterPodAnnotations = parseFilters('{$KUBE.POD.FILTER.ANNOTATIONS}');

    const output = [];
    input.nodes.forEach(function (node) {
        if (filter(node.metadata.name, node.metadata.labels, filterNodeLabels)
            && filter(node.metadata.name, node.metadata.annotations, filterNodeAnnotations)) {
            node.pods.forEach(function (pod) {
                if (filter(pod.name, pod.labels, filterPodLabels)
                    && filter(pod.name, pod.annotations, filterPodAnnotations)) {
                    Zabbix.log(4, '[ Kubernetes discovery ] Filtered pod "' + pod.name + '"');

                    output.push({
                        '{#POD}': pod.name,
                        '{#NAMESPACE}': pod.namespace,
                        '{#NODE}': node.metadata.name
                    });
                }
            });
        }
    });

    return JSON.stringify(output);
} catch (error) {
    Zabbix.log(2, '[ Kubernetes discovery ] ERROR: ' + error);
    throw error;
}
