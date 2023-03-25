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
    var isAllowed = true;

    if (typeof data !== 'object') {
        return isAllowed;
    }

    /* this is an 'optimized' forEach, where returning true breaks the for-loop,
     * because we have no interest in processing further filters if the item is
     * 'disqualified'.
     * TODO: It would be better written as `every(`
     */
    filters.some(function (filter) {

        const filter_key = filter.key.startsWith('!') ? filter.key.substring(1) : filter.key;
        if (!(filter_key in data)) {
            return false;
        }

        const isExcludingFilter = filter.key.startsWith('!');
        const isMatchForFilter = new RegExp(filter.expression).test(data[filter_key]);
        if ((isExcludingFilter && isMatchForFilter) ||
            (!isExcludingFilter && !isMatchForFilter)) {
            Zabbix.log(4, '[ Kubernetes discovery ] Discarded "' + name + '" by filter "' + filter.key + ': ' + filter.expression + '"');

            isAllowed = false;
            return true;
        }

        // we've passed this filter, let's try the rest
        return false;
    });

    return isAllowed;
}

try {
    var input = JSON.parse(value),
        output = [];

    if (typeof input !== 'object' || typeof input.items === 'undefined') {
        Zabbix.log(4, '[ Kubernetes ] Received incorrect JSON: ' + value);
        throw 'Incorrect JSON. Check debug log for more information.';
    }

    var filterNodeLabels = parseFilters('!kubernetes.io/hostname: \\w+-[1-2],  node-role.kubernetes.io/master: .*, dope'),
        filterNodeAnnotations = parseFilters('{$KUBE.NODE.FILTER.ANNOTATIONS}'),
        filterPodLabels = parseFilters(''),
        filterPodAnnotations = parseFilters('{$KUBE.POD.FILTER.ANNOTATIONS}');

    input.items.forEach(function (node) {
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
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes discovery ] ERROR: ' + error);
    throw 'Discovery error: ' + error;
}
