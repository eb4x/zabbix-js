function parseFilters(filter) {
    var pairs = {};

    filter.split(/\s*,\s*/).forEach(function (kv) {
        if (/([\w\.-]+\/[\w\.-]+):\s*.+/.test(kv)) {
            var pair = kv.split(/\s*:\s*/);
            pairs[pair[0]] = pair[1];
        }
    });

    return pairs;
}

function filter(name, data, filters) {
    var filtered = true;

    if (typeof data !== 'object') {
        return filtered;
    }

    Object.keys(filters).some(function (filter) {
        var exclude = filter.match(/^!(.+)/);
        if (filter in data || (exclude && exclude[1] in data)) {
            if ((exclude && new RegExp(filters[filter]).test(data[exclude[1]]))
                || (!exclude && !(new RegExp(filters[filter]).test(data[filter])))) {
                Zabbix.log(4, '[ Kubernetes discovery ] Discarded "' + name + '" by filter "' + filter + ': ' + filters[filter] + '"');

                filtered = false;
                return true;
            }
        }
    });

    return filtered;
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
