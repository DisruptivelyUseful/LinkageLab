// ============================================================================
// RESOURCE SYSTEM - Production appliances and resource management
// ============================================================================

function createResourceSystem(getAllItems, getLiveView) {
    'use strict';
    
    return {
        // Track resource levels by container ID
        containerLevels: {},
        
        // Initialize container levels
        initContainer(containerId, capacity) {
            if (this.containerLevels[containerId] === undefined) {
                this.containerLevels[containerId] = 0; // Start empty
            }
        },
        
        // Get container fill level (0-1)
        getContainerLevel(containerId, capacity) {
            const level = this.containerLevels[containerId] || 0;
            return Math.min(1, level / capacity);
        },
        
        // Add resource to container
        addToContainer(containerId, amount, capacity) {
            if (this.containerLevels[containerId] === undefined) {
                this.containerLevels[containerId] = 0;
            }
            this.containerLevels[containerId] = Math.min(capacity, this.containerLevels[containerId] + amount);
            return this.containerLevels[containerId];
        },
        
        // Remove resource from container
        removeFromContainer(containerId, amount) {
            if (this.containerLevels[containerId] === undefined) return 0;
            const removed = Math.min(this.containerLevels[containerId], amount);
            this.containerLevels[containerId] -= removed;
            return removed;
        },
        
        // Process production for all active producers
        processProduction(deltaHours) {
            const LiveView = getLiveView();
            if (!LiveView || !LiveView.state.active) return;
            
            const allItems = getAllItems();
            // Find all active producers
            const producers = allItems.filter(i => i.type === 'producer' && LiveView.state.loadStates[i.id]);
            
            producers.forEach(producer => {
                const recipe = producer.specs.recipe;
                if (!recipe || recipe.isStorage) return;
                
                // Calculate production amount
                const productionAmount = recipe.rate * deltaHours;
                
                // Check if producer needs input resource
                if (recipe.input) {
                    // Find connected input container
                    const inputContainer = this.findConnectedContainer(producer, recipe.input, allItems);
                    if (!inputContainer) return;
                    
                    // Try to consume input
                    const inputNeeded = productionAmount * 2; // 2:1 ratio
                    const consumed = this.removeFromContainer(inputContainer.id, inputNeeded);
                    if (consumed < inputNeeded * 0.5) return; // Not enough input
                }
                
                // Find connected output container
                const outputContainer = this.findConnectedContainer(producer, recipe.output, allItems);
                if (outputContainer) {
                    this.addToContainer(outputContainer.id, productionAmount, outputContainer.specs.capacity);
                } else {
                    // Store in internal tank if has one
                    if (producer.specs.tankSize) {
                        producer.internalStorage = Math.min(
                            producer.specs.tankSize,
                            (producer.internalStorage || 0) + productionAmount
                        );
                    }
                }
            });
        },
        
        // Find a container connected to a producer for a specific resource
        findConnectedContainer(producer, resourceType, allItems) {
            // Check all connections from producer
            const containers = allItems.filter(i => i.type === 'container' && i.specs.resource === resourceType);
            
            // For simplicity, find nearest container of matching type
            // In a full implementation, this would trace actual pipe connections
            return containers[0] || null;
        },
        
        // Export state
        exportState() {
            return { containerLevels: { ...this.containerLevels } };
        },
        
        // Import state
        importState(data) {
            if (data && data.containerLevels) {
                this.containerLevels = { ...data.containerLevels };
            }
        },
        
        // Clear all
        clearAll() {
            this.containerLevels = {};
        }
    };
}




